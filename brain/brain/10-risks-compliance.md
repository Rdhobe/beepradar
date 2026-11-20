# 10 — Risks & compliance

## Terms / legal hygiene
- Prefer official APIs and public ATS board APIs. Read each source's terms + `robots.txt`; record the date you checked in `02`.
- Honor attribution rules (e.g. Remotive requires linking back 🔎). Show a "Source" badge and "Apply at source" link on every card.
- Store only what's needed: title, company, location, a trimmed description, link. Don't republish full copyrighted listings as your own content.
- **Strip personal data**: recruiter emails/phones from descriptions before storing or sending to the LLM.
- Blocklisted sites (see `sources.yaml`) are never fetched, by code-level guard.
- API keys server-side only; never expose in client bundles; admin/run/tag endpoints require admin auth (Supabase + `ADMIN_EMAILS`). Keys at rest are encrypted (AES-256-GCM).
- Add a footer: "Aggregated from public sources; applications happen on the original site."

## Quality risks
| Risk | Mitigation |
|---|---|
| Scam / fee-based "internships" | Keyword filter + manual spot-check; only trusted sources |
| Expired jobs | `last_seen_at` + auto-deactivate after 14 days |
| Aggregator redirect links break/expire | Prefer ATS direct links; store both `canonical_url` & `apply_url` |
| Non-fresher roles labeled fresher | Heuristic + LLM `is_fresher`; review sample |
| Fewer than 200 after dedupe | Add Tier 2/3; widen `max_days_old`; more cities/keywords |
| LLM provider outage | Rule tagging at ingest is unaffected — the board still serves fully tagged rows (₹0). Optional LLM rows stay `pending`/`failed`, retried manually from `/admin` |
| Quota exhaustion mid-run | Per-source budgets, cache, spread queries |

## Security
Admin routes verify a Supabase Bearer access token via `requireAdmin()` and check the email against the `ADMIN_EMAILS` allowlist. Source API keys are encrypted at rest (`integration_secrets`, AES-256-GCM, master key in `SOURCE_KEYS_SECRET`). Public reads go through PostgREST with the anon key (SELECT GRANT + RLS). Rate-limit `/api/jobs`; parameterized SQL only (postgres.js tagged templates); blocklisted domains guarded in code.
