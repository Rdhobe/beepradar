import { sql } from "./db/client";
import { findDuplicate, findDuplicatesByKey, findFuzzyDuplicates } from "./dedupe";
import { canonicalizeUrl, cleanDescription, fingerprint, normCompany, normTitle, parseDate, stripHtml } from "./normalize";
import { prefilter, type RawJob } from "./prefilter";
import { STALE_DAYS } from "./registry";
import { RULE_TAG_MODEL, tagJob } from "./rule_tagger";
import type { JobType, Role } from "./taxonomy";

export interface IngestCounts {
  fetched: number;
  passed_filter: number;
  inserted: number;
  dup_url: number;
  dup_fingerprint: number;
  dup_fuzzy: number;
}

export async function ingestRawJobs(sourceId: string, rawJobs: RawJob[]): Promise<IngestCounts> {
  const counts: IngestCounts = {
    fetched: rawJobs.length, passed_filter: 0, inserted: 0,
    dup_url: 0, dup_fingerprint: 0, dup_fuzzy: 0,
  };
  const runRows = await sql`
    INSERT INTO ingest_runs (source, started_at) VALUES (${sourceId}, now()) RETURNING id`;
  const runId = runRows[0].id;
  try {
    type Cand = {
      url: string; applyUrl: string; title: string; company: string; sourceId: string | null;
      locationRaw: string | null; description: string | null; postedAt: string | null;
      companyNorm: string; titleNorm: string; city: string | null; fp: string;
      india: boolean; fresher: boolean; role: Role; jobType: JobType; tagConfidence: number;
    };
    const cands: Cand[] = [];
    for (const raw of rawJobs) {
      const title = stripHtml(raw.title).slice(0, 300);
      const company = stripHtml(raw.company).slice(0, 200);
      const url = canonicalizeUrl(raw.url);
      if (!title || !company || !url) continue;
      const job: RawJob = {
        source: sourceId, sourceId: raw.sourceId, url, title, company,
        locationRaw: raw.locationRaw, description: cleanDescription(raw.description),
        postedAt: raw.postedAt, licensedFeed: raw.licensedFeed,
      };
      const { india, fresher, reject } = prefilter(job);
      if (reject) continue;
      counts.passed_filter++;
      const tag = tagJob({ title, company, locationRaw: job.locationRaw, description: job.description });
      cands.push({
        url, applyUrl: raw.url, title, company, sourceId: raw.sourceId ?? null,
        locationRaw: job.locationRaw ?? null, description: job.description ?? null,
        postedAt: parseDate(job.postedAt), companyNorm: normCompany(company), titleNorm: normTitle(title),
        city: tag.city, fp: fingerprint(company, title, tag.city), india, fresher,
        role: tag.role, jobType: tag.job_type, tagConfidence: tag.confidence,
      });
    }

    const { byUrl, byFp } = await findDuplicatesByKey(cands.map((c) => c.url), cands.map((c) => c.fp));
    const companyRows = await sql`SELECT DISTINCT company_norm FROM jobs`;
    const companies = new Set(companyRows.map((r) => r.company_norm as string));

    const touches: { id: number; url: string }[] = [];
    const fresh: Cand[] = [];
    const fuzzyPending: { key: string; companyNorm: string; city: string | null; titleNorm: string; cand: Cand }[] = [];
    for (const c of cands) {
      const urlId = byUrl.get(c.url);
      if (urlId != null) { counts.dup_url++; touches.push({ id: urlId, url: c.url }); continue; }
      const fpId = byFp.get(c.fp);
      if (fpId != null) { counts.dup_fingerprint++; touches.push({ id: fpId, url: c.url }); continue; }
      if (companies.has(c.companyNorm)) {
        fuzzyPending.push({
          key: `${c.url}|${c.companyNorm}|${c.city}|${c.titleNorm}`,
          companyNorm: c.companyNorm, city: c.city, titleNorm: c.titleNorm, cand: c,
        });
      } else {
        fresh.push(c);
      }
    }
    const fuzzyHits = await findFuzzyDuplicates(fuzzyPending);
    for (const p of fuzzyPending) {
      const id = fuzzyHits.get(p.key);
      if (id != null) { counts.dup_fuzzy++; touches.push({ id, url: p.cand.url }); }
      else fresh.push(p.cand);
    }

    const seen: { job_id: number; source: string; url: string }[] = [];
    if (fresh.length) {
      const rows = fresh.map((c) => ({
        source: sourceId, source_id: c.sourceId, canonical_url: c.url, apply_url: c.applyUrl,
        title: c.title, company: c.company, company_norm: c.companyNorm, title_norm: c.titleNorm,
        location_raw: c.locationRaw, description: c.description, posted_at: c.postedAt,
        fingerprint: c.fp, is_india: c.india, is_fresher: c.fresher, city: c.city,
        role: c.role, job_type: c.jobType, tag_status: "done", tag_confidence: c.tagConfidence,
        tagged_at: new Date().toISOString(), tag_model: RULE_TAG_MODEL,
      }));
      const ins = await sql`
        INSERT INTO jobs ${sql(rows, "source", "source_id", "canonical_url", "apply_url", "title", "company",
          "company_norm", "title_norm", "location_raw", "description", "posted_at", "fingerprint",
          "is_india", "is_fresher", "city", "role", "job_type", "tag_status", "tag_confidence",
          "tagged_at", "tag_model")}
        ON CONFLICT DO NOTHING
        RETURNING id, canonical_url`;
      const got = new Map(ins.map((r) => [r.canonical_url as string, Number(r.id)]));
      for (const c of fresh) {
        const id = got.get(c.url);
        if (id != null) { counts.inserted++; seen.push({ job_id: id, source: sourceId, url: c.url }); }
        else {
          const hit = await findDuplicate({ canonicalUrl: c.url, fingerprint: c.fp, companyNorm: c.companyNorm, city: c.city, titleNorm: c.titleNorm });
          if (hit) { counts[`dup_${hit.layer}`]++; touches.push({ id: hit.id, url: c.url }); }
        }
      }
    }

    if (touches.length) {
      const ids = [...new Set(touches.map((t) => t.id))];
      await sql`UPDATE jobs SET last_seen_at = now() WHERE id = ANY(${ids})`;
      for (const t of touches) seen.push({ job_id: t.id, source: sourceId, url: t.url });
    }
    if (seen.length) {
      await sql`INSERT INTO job_sources_seen ${sql(seen, "job_id", "source", "url")} ON CONFLICT DO NOTHING`;
    }

    await sql`
      UPDATE ingest_runs SET finished_at = now(), fetched = ${counts.fetched},
        passed_filter = ${counts.passed_filter}, inserted = ${counts.inserted},
        dup_url = ${counts.dup_url}, dup_fingerprint = ${counts.dup_fingerprint}, dup_fuzzy = ${counts.dup_fuzzy}
      WHERE id = ${runId}`;
  } catch (e) {
    await sql`UPDATE ingest_runs SET finished_at = now(), error = ${String(e).slice(0, 500)} WHERE id = ${runId}`;
    throw e;
  }
  return counts;
}

export async function expireStale(days = STALE_DAYS): Promise<number> {
  const rows = await sql`
    UPDATE jobs SET is_active = false
    WHERE is_active = true AND last_seen_at < now() - make_interval(days => ${days})
    RETURNING id`;
  return rows.length;
}