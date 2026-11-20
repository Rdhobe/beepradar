import { sql } from "./db/client";
import { FUZZY_THRESHOLD } from "./registry";

export type DedupeHit = { layer: "url" | "fingerprint" | "fuzzy"; id: number };

export async function findDuplicate(args: {
  canonicalUrl: string;
  fingerprint: string;
  companyNorm: string;
  city: string | null;
  titleNorm: string;
}): Promise<DedupeHit | null> {
  const byKey = await sql`
    SELECT id, canonical_url FROM jobs
    WHERE canonical_url = ${args.canonicalUrl} OR fingerprint = ${args.fingerprint}
    ORDER BY (canonical_url = ${args.canonicalUrl}) DESC
    LIMIT 1`;
  if (byKey[0]) {
    return { layer: byKey[0].canonical_url === args.canonicalUrl ? "url" : "fingerprint", id: Number(byKey[0].id) };
  }
  return findFuzzyDuplicate(args);
}

export async function findFuzzyDuplicate(args: {
  companyNorm: string;
  city: string | null;
  titleNorm: string;
}): Promise<DedupeHit | null> {
  const fuzzy = await sql`
    SELECT id FROM jobs
    WHERE company_norm = ${args.companyNorm}
      AND (city = ${args.city}::text OR (city IS NULL AND ${args.city}::text IS NULL))
      AND similarity(title_norm, ${args.titleNorm}) > ${FUZZY_THRESHOLD}::real
    LIMIT 1`;
  if (fuzzy[0]) return { layer: "fuzzy", id: Number(fuzzy[0].id) };
  return null;
}

// One round-trip for the fuzzy layer across ALL candidates (per-candidate queries
// saturate the transaction pooler on heavy sources). v.city is typed by the
// recordset, so nullable cities never produce an untyped-parameter error.
export async function findFuzzyDuplicates(
  cands: { key: string; companyNorm: string; city: string | null; titleNorm: string }[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!cands.length) return out;
  const payload = cands.map((c) => ({ k: c.key, company_norm: c.companyNorm, city: c.city, title_norm: c.titleNorm }));
  const rows = await sql`
    SELECT v.k AS k, j.id AS id
    FROM jsonb_to_recordset(${sql.json(payload)})
      AS v(k text, company_norm text, city text, title_norm text)
    JOIN LATERAL (
      SELECT id FROM jobs j
      WHERE j.company_norm = v.company_norm
        AND (j.city = v.city OR (j.city IS NULL AND v.city IS NULL))
        AND similarity(j.title_norm, v.title_norm) > ${FUZZY_THRESHOLD}::real
      LIMIT 1
    ) j ON true`;
  for (const r of rows) out.set(r.k as string, Number(r.id));
  return out;
}

// One round-trip for the url + fingerprint layers across many candidates.
// Returns maps so callers can resolve layers in JS; fuzzy stays per-candidate.
export async function findDuplicatesByKey(
  urls: string[],
  fingerprints: string[],
): Promise<{ byUrl: Map<string, number>; byFp: Map<string, number> }> {
  const byUrl = new Map<string, number>();
  const byFp = new Map<string, number>();
  if (!urls.length && !fingerprints.length) return { byUrl, byFp };
  const rows = await sql`
    SELECT id, canonical_url, fingerprint FROM jobs
    WHERE canonical_url IN ${sql(urls.length ? urls : [""])} OR fingerprint IN ${sql(fingerprints.length ? fingerprints : [""])}`;
  for (const r of rows) {
    if (r.canonical_url != null && !byUrl.has(r.canonical_url as string)) byUrl.set(r.canonical_url as string, Number(r.id));
    if (r.fingerprint != null && !byFp.has(r.fingerprint as string)) byFp.set(r.fingerprint as string, Number(r.id));
  }
  return { byUrl, byFp };
}