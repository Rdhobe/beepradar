# 05 — Pipeline

> **As-built change.** No cron. The pipeline is driven **by hand from `/admin`**
> (run one source, run a selection, or run the ready queue). Every job is
> **rule-tagged at INSERT** (`tag_status='done'`, `tag_model='rule-v1'`); the LLM
> pass is an optional override (see `06`). After any run attempt a source enters a
> **6-hour cooldown**. All adapters are TypeScript — the Python worker / GitHub
> Actions path from the original plan is **not used**.

## Stages
1. **Fetch** (adapter) → `RawJob[]`. Retries with backoff, per-source timeout, per-source error isolation (one failing source never fails the run).
2. **Normalize** → strip HTML to text, canonicalize URL (drop `utm_*`, `gclid`, tracking redirects), trim description, parse dates. **Raw HTML is kept in the DB**; cleaning happens at the read layer only.
3. **Pre-filter (free, deterministic)** — `lib/prefilter.ts`
   - `is_india`: location matches gazetteer / "India" / `IN`; remote jobs only if text says India/APAC-eligible.
   - `is_fresher` heuristic: fresher keywords in title/desc OR experience ≤ 1 yr parsed (`0-1 years`, `fresher`, `graduate`, `intern`). Reject "5+ years", "senior", "lead", "manager" in title.
   - Reject if domain on blocklist or description looks like a scam (fee-to-apply, "registration fee").
4. **Rule-tag (free, deterministic)** — `lib/rule_tagger.ts` `tagJob()` produces role / city / job_type / is_fresher / confidence for each candidate that passed the filter (see `06`).
5. **Dedupe** (3 layers, log which layer fired):
   | Layer | Rule | Catches |
   |---|---|---|
   | 1. URL | `UNIQUE(canonical_url)` | Same link re-fetched daily |
   | 2. Fingerprint | `sha1(norm(company)+norm(title)+city_guess)` unique | Same job from Adzuna + Jooble + ATS |
   | 3. Fuzzy | same company + city and `similarity(title) > 0.85` (pg_trgm) | "Software Engineer Intern" vs "SDE Intern – Software", reposts |
   On a duplicate: don't insert; add a row in `job_sources_seen`, bump `last_seen_at`.
   `norm()` = lowercase, strip punctuation, remove legal suffixes (Pvt Ltd, Inc, LLP, Technologies), collapse whitespace.
6. **Insert** — new rows are written **already tagged**: `tag_status='done'`, `tag_model='rule-v1'`, `tagged_at=now()`, plus `role/city/job_type/is_fresher/tag_confidence`. Batched typed INSERT (`ON CONFLICT DO NOTHING`). No pending queue for normal ingest.
7. **Optional LLM override** (manual, see `06`): `POST /api/admin/tag` drains any `tag_status='pending'` rows in batches; `POST /api/admin/retag` backfills old/untagged rows with the same rules. Not part of the ingest run.
8. **Expire**: rows not seen for `STALE_DAYS` (14) flip `is_active=false` (job closed) instead of being deleted.
9. **Serve**: `/api/jobs?q=&role=&city=&type=&page=` → `ts_rank` + filters; UI shows "Last refreshed" from `ingest_runs`.

### Read-layer description formatting (as-built)
The DB keeps **raw HTML**; formatting happens only when serving:
- **Cards/snippets** — `cleanDescription()` (`lib/normalize.ts`): strip tags, collapse whitespace, PII-scrub, truncate.
- **Job modal** — `formatDescription()` (`lib/normalize.ts`) parses the stored HTML with cheerio into **markdown-lite**: `h1–h6` → `## Heading`, `li` → `- bullet` (nested lists preserved), `br` → newline, block elements → paragraph breaks, table rows → `a · b`; scripts/styles/forms stripped; PII scrubbed; capped at 4,000 chars. Plain-text posts get `•`/`*` normalized to `- `.
- `GET /api/jobs/[id]` returns the formatted text; `JobModal` → `DescriptionBody` renders headings, bold, square-bullet lists and paragraphs (brutalist, green left rule). The modal chip is honest about provenance: **rule-tagged** (`tag_model='rule-v1'`) vs **ai-tagged** + confidence.

## Run model (manual, no cron)
`POST /api/admin/run` (admin auth) dispatches on the body:
| Body | Mode | Calls |
|---|---|---|
| `{source_id, limit?}` | single | `runSource(id, limit)` |
| `{source_ids:[…]}` | selected | `runSelected(ids, 38_000, 5)` — chunked budgets, ≤ 5 sources/invocation |
| `{}` (empty) | tick | `tick(38_000)` — runs only **due** sources |

`lib/runner.ts` `runSource()` gates on, in order: enabled → backoff (`backoff_until`)
→ **cooldown** (`next_due_at` in the future) → quota. It fetches, ingests, logs an
`ingest_runs` row, and **stamps `next_due_at = now() + 6h`** on every outcome
(ok / error / rate_limited). `lib/scheduler.ts` `dueSources()` and `runSelected()`
skip sources whose `next_due_at` is still in the future; `quota_exhausted` sources
stay due. The `/admin` ready queue lists only connected sources with quota left
**and off cooldown**; cooling sources show a `COOLDOWN {h}m` chip and a disabled
Run button.

### 6-hour cooldown
- Constant `RUN_COOLDOWN_MS = 6 * 60 * 60 * 1000` in `lib/registry.ts`.
- Stored in the existing `source_state.next_due_at` column — **no schema change**.
- Enforced server-side (runSource gate + stamp; runSelected skip; dueSources gate)
  and client-side (ready filter, chips, disabled buttons).

## Adapter interface (TS)
```ts
export type RawJob = {
  source: string; sourceId?: string; url: string; title: string; company: string;
  locationRaw?: string; description?: string; postedAt?: string;
};
export interface SourceAdapter {
  id: string;
  fetch(ctx: { signal: AbortSignal; limit?: number }): Promise<RawJob[]>;
}
```
Adapters live in `lib/sources/*.ts`. The registry (`lib/registry.ts` +
`sources_registry.json`) is merged with DB patches/custom sources from
`source_admin` at load (`loadRegistry`), so the admin panel can enable/disable,
re-limit, and add sources without a redeploy. Custom sources select adapter logic
via `api.adapter`.

## DB channels (Supabase)
- **Writes** (ingest, tagging, run logging, admin mutations): Postgres wire via
  `DATABASE_URL` (transaction pooler :6543, `prepare:false`, `ssl:"require"`,
  `max:5`). Every query auto-cancels server-side at a 12 s deadline so a slow
  query can't orphan a pooled backend (see `lib/db/client.ts`).
- **Public + admin-log reads**: PostgREST over HTTPS (`lib/db/rest.ts`,
  `ensureRest()` probe) — stateless, an aborted fetch releases the backend.
  Falls back to the wire pool only if the REST probe genuinely fails.

## Refresh proof checklist (manual)
- [ ] `ingest_runs` shows ≥ 2 consecutive run days (triggered from `/admin`)
- [ ] A re-run inserts only *new* jobs (dup_url count high) — screenshot for the video
- [ ] "Last refreshed" on the page changes after a run
- [ ] A source shows a `COOLDOWN` chip and refuses to re-run for 6 h

## Politeness
Custom `User-Agent` with contact email, honor robots.txt for any HTML source,
delay per host, cache ETag/Last-Modified (`http_cache`), no parallel hammering of
one host. Per-source daily quotas tracked in `source_quota_usage`; 429s apply
exponential backoff (`source_state.backoff_until`, `consecutive_429`).