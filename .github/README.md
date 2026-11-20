# `.github/` — repository automation

This folder holds GitHub-specific configuration.

- `workflows/` — GitHub Actions definitions. It is currently **empty**: there is no CI, no scheduled ingest, and no deploy workflow.
- Ingestion is **not** driven by GitHub Actions in the current build. On Vercel there is no cron either; runs are started manually from `/admin → Run due sources`.
- See `deprecated/cron/` for the retired Vercel-cron experiment. Do not revive it without re-checking quota and cooldown behavior.

## Rules

- Never commit API keys here. Secrets belong in Vercel environment variables or the encrypted vault (`SOURCE_KEYS_SECRET`).
- If you add a workflow, keep it read-only by default. Any job that calls `/api/admin/run` must send the `CRON_SECRET`/`INGEST_SECRET` header and respect the source registry's quotas.
- A future CI workflow should run: `npm test`, `npx tsc --noEmit`, `npm run build` from `frontend/`, and `pytest` from `backend/`.
