# `frontend/` — the deployed Next.js application

This is the production app: public job board, Supabase auth, admin Control room, stats, and the quota-aware source runner.

## Commands

```bash
npm install
npm run dev            # http://localhost:3000
npm test               # vitest
npx tsc --noEmit
npm run build
npm start
npm run ingest         # CLI ingest using the same registry/runner
npm run probe          # probe ATS boards for India-hiring tokens
```

## Routes

| Route | Who | What it does |
|---|---|---|
| `/` | public | Landing page with live counts and a 6-job preview |
| `/login` | public | Supabase email/password sign-in and sign-up |
| `/jobs` | public | Preview mode (6 jobs); signed-in users get search, filters, pagination, apply links |
| `/admin` | `ADMIN_EMAILS` only | Run ingestion, connect keys, edit sources, configure tagging, watch live log |
| `/admin/stats` | admin | Funnel by source, duplicate types, LLM unit cost, quota/cooldown state |
| `/admin/flow` | admin | Explains the whole system — linked from the **Flow →** button beside **Stats →** |

## Layout

- `app/` — pages and API route handlers
- `components/` — shared UI (auth nav, job modal)
- `lib/` — registry, quota, HTTP client, adapters, dedupe, tagging, db, secrets
- `data/sources_registry.json` — **runtime source registry** (single source of truth)
- `scripts/` — CLI ingest / probes / SQLite migration helpers
- `tests/` — 205 unit tests
- `public/` — logo and static assets

## Environment

Copy `.env.example` to `.env.local` for local work. In Vercel, set variables under **Project Settings → Environment Variables** and redeploy.

Required: `DATABASE_URL` (Supabase transaction pooler, port 6543), `ADMIN_EMAILS`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SOURCE_KEYS_SECRET` (64 hex chars), `USER_AGENT` (replace domain/contact placeholders).

Feed keys: `CAREERJET_API_KEY`, `RAPIDAPI_KEY`, `HIMALAYAS_API_KEY`, `SERPAPI_KEY`, `JOBSPIPE_API_KEY`, `APIFY_TOKEN`. Tagging: `GROQ_API_KEY`. Optional trial feeds: `CLEANJOBDATA_API_KEY`, `FANTASTIC_JOBS_API_KEY`.

`.env` exists locally and may contain real values — never commit it or show it in a recording.

## Deployment notes

- There is **no Vercel cron**. Runs are started manually from `/admin`.
- Keys can come from env or the encrypted `integration_secrets` vault; the vault wins when both exist.
- Blocklisted sites are never fetched. Licensed feeds are stored with `licensedFeed=true` for link-back only.
- See `../files/VIDEO_SCRIPT.md` for the walkthrough and `../brain/` for the design docs.
