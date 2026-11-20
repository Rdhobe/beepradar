# 09 — Video walkthrough (target 5–8 min)

| Time | Segment | Show |
|---|---|---|
| 0:00–0:30 | Demo: live site, search "data analyst pune", filters, "last refreshed" | Browser |
| 0:30–2:00 | Architecture: sources → TS adapters → normalize → pre-filter → **rule-tag** → dedupe → Supabase → UI; optional LLM override; manual `/admin` runs + 6 h cooldown | Mermaid diagram from `01` |
| 2:00–3:00 | Sources & compliance: what's used, what's deliberately **not** scraped and why | `02` table |
| 3:00–4:30 | **What broke & how I fixed it** (use real ones — template below) | Logs / commits |
| 4:30–5:30 | Numbers: raw → unique funnel; accuracy table + confusion; **cost/1k in ₹** + live estimator | `07` tables, `/admin/stats` |
| 5:30–6:30 | Refresh proof: two **manual `/admin` runs**, day-2 only inserts new; show the **6 h cooldown** chip | `ingest_runs`, `source_state` |
| 6:30–7:00 | Limitations + what I'd do next | |

## "What broke" log — fill in during the build (don't fabricate; these are likely candidates)
| # | Symptom | Root cause | Fix | Evidence (commit/screenshot) |
|---|---|---|---|---|
| 1 | Same job appears 3× | Same posting via Adzuna + Jooble + company ATS with different URLs | Fingerprint + pg_trgm fuzzy layer | |
| 2 | Bulk run returned 503 / pool saturated | Abandoned queries orphaned Supabase pooler backends in `ClientRead` | 12 s server-side query auto-cancel + PostgREST reads + chunked run budgets | |
| 3 | LLM returned invalid JSON / out-of-enum role | Free-text drift | Zod validation + repair retry + enum in prompt | |
| 4 | "Bengaluru" vs "Bangalore" vs "Bengaluru Urban" | Inconsistent location strings | Gazetteer + LLM city enum | |
| 5 | Non-India or senior roles slipped in | Aggregator `where` fuzziness | India + fresher pre-filter | |
| 6 | Source rate-limited / 429 / quota exhausted | Free-tier limits | Backoff, caching, query budgeting | |
| 7 | HTML in descriptions inflated tokens / cluttered cards | Raw HTML stored in DB | Clean at the **read layer** + truncate before the LLM (DB keeps raw) | |
| 8 | Day-2 run re-inserted rows | Missing unique constraint | `UNIQUE(canonical_url)`, `UNIQUE(fingerprint)` | |
