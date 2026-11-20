# 03 — Tech stack

> **As-built.** Everything lives in `frontend/` (Next.js App Router + TS). DB is
> **Supabase Postgres** accessed with **postgres.js** (writes) and **PostgREST**
> (reads) — no Drizzle, no Neon. **No cron** and **no Python worker** in the live
> path; all sources are TS adapters and runs are manual from `/admin`.

## Core
| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript | Route handlers for ingest/run/tag/admin/search/stats |
| UI | Tailwind CSS, **brutalist** design system (`bcard/bbtn/bchip/btable`) | Paper `#f4f1ea`, ink `#000`, yellow `#ffd400`, blue `#2400ff`, red `#ff3b30`, green `#00a651` |
| DB | **Supabase Postgres** (free tier) | Extensions: `pg_trgm`, built-in FTS (`tsvector`) |
| DB access | **postgres.js** wire pooler (writes) + **PostgREST** fetch (reads) | `prepare:false`, `ssl:"require"`, `max:5`, 12 s query auto-cancel; `ensureRest()` probe for reads |
| Auth | **Supabase Auth** + `ADMIN_EMAILS` allowlist | Browser Bearer access token → `requireAdmin()` |
| Validation | Zod | Source payloads **and** LLM JSON |
| Rule tagger | `lib/rule_tagger.ts` | Deterministic keywords + gazetteer, ₹0, at ingest |
| LLM (optional) | Claude Haiku 5.5 (`claude-haiku-5-5`) default; `@anthropic-ai/sdk` | Structured JSON, temperature 0, batched, cached prompt |
| Secrets | AES-256-GCM (`lib/secrets.ts`) + `SOURCE_KEYS_SECRET` | Encrypted API keys in `integration_secrets`, global by name |
| Pricing | `lib/pricing.ts` | USD rates → INR at `USD_INR_RATE`; env-overridable |
| Hosting | Vercel (Hobby) | No cron configured; manual runs |
| Tests | Vitest | normalize, dedupe, cities, prefilter, tagger, pricing, sources, integrations, db-errors |
| Observability | `ingest_runs`, `llm_runs`, `source_state`, `source_quota_usage` + `/admin/stats` | Funnel, INR cost/1,000, estimator |

## Environment variables
```
# DB / Supabase
DATABASE_URL=                      # Supabase transaction pooler (port 6543), writes
NEXT_PUBLIC_SUPABASE_URL=          # Auth + PostgREST reads
NEXT_PUBLIC_SUPABASE_ANON_KEY=     # anon key (needs SELECT GRANT + RLS for REST reads)

# Admin
ADMIN_EMAILS=                      # comma-separated allowlist of admin emails
SOURCE_KEYS_SECRET=                # 32-byte master key (hex/base64) for AES-256-GCM secrets

# Optional LLM tagger (multi-provider; admin Configure writes tagging_config + key)
GROQ_API_KEY=                      # Groq (default paid provider) — env OR encrypted via /admin
OPENAI_API_KEY=                    # OpenAI / ChatGPT — env OR encrypted via /admin
ANTHROPIC_API_KEY=                 # Anthropic / Claude — env OR encrypted via /admin
LLM_PROVIDER=                      # groq | openai | anthropic (fallback when tagging_config absent)
LLM_MODEL=                         # model id; legacy claude-* infers provider=anthropic
TAG_MODE=                          # free | llm (fallback; default free)
LLM_BATCH_SIZE=10

# Pricing (USD per 1M tokens; FX separate) — all optional
LLM_INPUT_PRICE_PER_M=
LLM_OUTPUT_PRICE_PER_M=
LLM_CACHE_READ_PRICE_PER_M=
USD_INR_RATE=84                    # default 84 if unset/invalid

# Source API keys (env OR encrypted in integration_secrets via /admin)
ADZUNA_APP_ID=
ADZUNA_APP_KEY=
JOOBLE_API_KEY=
CAREERJET_API_KEY=
RAPIDAPI_KEY=                      # JSearch / Active Jobs DB / HireBase / LinkedIn Job Search (RapidAPI)
FANTASTIC_JOBS_API_KEY=            # Fantastic.jobs direct dashboard key (100 req / 500 jobs / 14-day trial)
SERPAPI_KEY=                       # SerpApi Google Jobs / Indeed Jobs / Glassdoor Jobs
JOBSPIPE_API_KEY=                  # JobsPipe Bearer token
CLEANJOBDATA_API_KEY=              # CleanJobData India fresher/intern feed (14-day trial)
APIFY_TOKEN=                       # Apify Actors: parsebird/naukri-jobs-scraper, crawloop/internshala-scraper, crawloop/foundit-jobs-scraper
USER_AGENT=                        # default BeepRadarBot/1.0 (+contact)
```
> Source keys may be supplied via env **or** stored encrypted in
> `integration_secrets` and managed from `/admin` → Integrations. Never commit
> real keys; never round-trip secrets through chat.

## Repo layout (as-built)
```
/
├─ files/brain/                    # this folder (source of truth)
└─ frontend/
   ├─ app/
   │  ├─ page.tsx                  # landing
   │  ├─ jobs/page.tsx             # search UI (FTS + filters, gated for anon)
   │  ├─ login/page.tsx            # Supabase Auth
   │  ├─ admin/page.tsx            # integrations, run/bulk/ready, tagging, live log
   │  ├─ admin/stats/page.tsx      # funnel + INR pricing + cost estimator
   │  └─ api/
   │     ├─ jobs/route.ts  ├─ jobs/[id]/route.ts   # search + detail
   │     ├─ stats/route.ts ├─ sources/route.ts ├─ meta/route.ts
   │     └─ admin/
   │        ├─ run/route.ts        # single | selected | tick (manual)
   │        ├─ retag/route.ts      # rule backfill (₹0)
   │        ├─ tag/route.ts        # optional LLM pass / retry failed
   │        ├─ tagging/route.ts    # tag analysis: counts + llm_runs + config
   │        ├─ runlog/route.ts     # fresh-per-run live log
   │        ├─ sources/route.ts  ├─ sources/[id]/route.ts
   │        ├─ secrets/route.ts  ├─ secrets/[name]/route.ts
   │        ├─ test-fetch/route.ts └─ me/route.ts
   ├─ lib/
   │  ├─ sources/*.ts              # TS adapters (aggregators, licensed_apis, ATS, feeds, custom)
   │  ├─ normalize.ts ├─ dedupe.ts ├─ cities.ts ├─ prefilter.ts ├─ taxonomy.ts
   │  ├─ rule_tagger.ts ├─ tagger.ts ├─ pricing.ts
   │  ├─ registry.ts ├─ runner.ts ├─ scheduler.ts ├─ pipeline.ts ├─ secrets.ts
   │  ├─ admin/auth.ts ├─ supabase/client.ts
   │  └─ db/{client.ts,rest.ts,errors.ts,schema.sql}
   ├─ scripts/{ingest.ts,migrate_sqlite.ts,…}
   ├─ tests/*.test.ts              # Vitest
   └─ public/images/…
```

## No cron
There is **no `vercel.json` crons block** and no GitHub Actions schedule. Refresh
is manual: `/admin` → Run / Bulk run / Ready queue → `POST /api/admin/run`. A
6-hour per-source cooldown (`source_state.next_due_at`) prevents re-running a
source too soon. Serverless max duration is bounded with chunked budgets
(`runSelected` ≤ 5 sources / 38 s; `tick` 38 s) and the 12 s query auto-cancel.

## Free-tier constraints designed around
- Serverless function max duration → small batches, chunked run budgets, resumable ready queue.
- Aggregator daily quotas → `source_quota_usage` tracking, backoff on 429, cooldown.
- Supabase transaction pooler forbids prepared statements and ignores `statement_timeout` → `prepare:false` + out-of-band query cancel; reads offloaded to PostgREST.
- Supabase free storage is plenty for ~thousands of rows.