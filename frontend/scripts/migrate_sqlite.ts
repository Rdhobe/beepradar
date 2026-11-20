// One-time migration: prototype SQLite jobs -> Supabase Postgres.
// Usage: DATABASE_URL=<supabase pooler uri> npm run migrate:sqlite
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { sql } from "../lib/db/client";
import { normCompany, normTitle } from "../lib/normalize";

const SQLITE_PATH = process.argv[2] ?? path.join(process.cwd(), "backend", "data", "beepradar.db");

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set — export your Supabase pooler URI first.");
    process.exit(1);
  }
  const lite = new DatabaseSync(SQLITE_PATH, { readOnly: true });
  const jobs = lite.prepare("SELECT * FROM jobs ORDER BY id").all() as Record<string, any>[];
  console.log(`read ${jobs.length} jobs from ${SQLITE_PATH}`);

  const idMap = new Map<number, number>();
  let inserted = 0, skipped = 0;
  for (const j of jobs) {
    const rows = await sql`
      INSERT INTO jobs (source, source_id, canonical_url, apply_url, title, company, company_norm, title_norm,
        location_raw, description, posted_at, first_seen_at, last_seen_at, is_active, fingerprint,
        is_india, is_fresher, tag_status, role, city, job_type, tag_confidence, tagged_at, tag_model)
      VALUES (${j.source}, ${j.source_id}, ${j.canonical_url}, ${j.apply_url}, ${j.title}, ${j.company},
        ${normCompany(j.company)}, ${normTitle(j.title)}, ${j.location_raw}, ${j.description},
        ${j.posted_at}, ${j.first_seen_at}, ${j.last_seen_at}, ${!!j.is_active}, ${j.fingerprint},
        ${!!j.is_india}, ${j.is_fresher == null ? null : !!j.is_fresher}, ${j.tag_status},
        ${j.role}, ${j.city}, ${j.job_type}, ${j.tag_confidence}, ${j.tagged_at}, ${j.tag_model})
      ON CONFLICT DO NOTHING
      RETURNING id`;
    if (rows[0]) {
      idMap.set(j.id, Number(rows[0].id));
      inserted++;
    } else {
      skipped++;
    }
  }
  console.log(`jobs: ${inserted} inserted, ${skipped} already present`);

  const seen = lite.prepare("SELECT * FROM job_sources_seen").all() as Record<string, any>[];
  let seenInserted = 0;
  for (const s of seen) {
    const newId = idMap.get(s.job_id);
    if (!newId) continue;
    const rows = await sql`
      INSERT INTO job_sources_seen (job_id, source, url, seen_at)
      VALUES (${newId}, ${s.source}, ${s.url}, ${s.seen_at})
      ON CONFLICT DO NOTHING RETURNING job_id`;
    if (rows[0]) seenInserted++;
  }
  console.log(`job_sources_seen: ${seenInserted} inserted`);

  const runs = lite.prepare("SELECT * FROM ingest_runs").all() as Record<string, any>[];
  for (const r of runs) {
    await sql`
      INSERT INTO ingest_runs (source, started_at, finished_at, fetched, passed_filter, inserted,
        dup_url, dup_fingerprint, dup_fuzzy, error)
      VALUES (${r.source}, ${r.started_at}, ${r.finished_at}, ${r.fetched}, ${r.passed_filter},
        ${r.inserted}, ${r.dup_url}, ${r.dup_fingerprint}, ${r.dup_fuzzy}, ${r.error})`;
  }
  console.log(`ingest_runs: ${runs.length} copied (funnel history for the stats page)`);

  const [{ c }] = await sql`SELECT count(*)::int AS c FROM jobs`;
  console.log(`Supabase now has ${c} jobs total.`);
  lite.close();
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });