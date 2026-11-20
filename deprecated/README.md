# `deprecated/` — archived experiments

Nothing in this folder is part of the deployed application. It is kept as a record of decisions already tried.

- `cron/api-cron/` — the old Vercel cron endpoint attempt (`vercel.json`, ingest ping route, tag route). Retired because a serverless cron could not reliably honor per-source quotas and cooldowns.
- `cron/ingest-ping.yml` — old scheduled ping definition.

## Current behavior

Ingestion is manual and auditable: sign in, open `/admin`, and use **Run due sources →**, the ready queue, or bulk run. The runner enforces per-source quota windows, the 6-hour cooldown, 429 backoff, and dedupe.

Do not copy code from this folder into production without re-reviewing it against `frontend/data/sources_registry.json` and the current runner. No secrets should live here.
