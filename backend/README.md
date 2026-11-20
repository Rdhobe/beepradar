# `backend/` — Python worker (optional)

FastAPI + APScheduler implementation of the same ingest → normalize → dedupe → tag pipeline. The Vercel-deployed app currently runs ingestion from the Next.js Control room (`/admin`); this Python service is the long-running alternative for heavier sources and local experiments.

## Layout

| Path | Purpose |
|---|---|
| `app/` | FastAPI app, CLI, quota tracker, scheduler, adapters, dedupe, tagger |
| `app/sources/` | Python source adapters |
| `tests/` | `pytest` unit tests |
| `scripts/` | One-off board probes |
| `data/` | Local SQLite DB and seed token lists (not production data) |
| `.env.example` | Documented env vars — copy to `.env`, never commit real values |

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env
python -m app.cli init
```

## Common commands

```bash
python -m app.cli ingest --source <id>   # one source, quotas still enforced
python -m app.cli ingest --due           # cron-due sources only
python -m app.cli scheduler              # 15-minute quota-aware loop
python -m app.cli tag                    # drain pending LLM tagging queue
python -m app.cli serve                  # FastAPI on API_HOST:API_PORT
python -m app.cli stats                  # ingest / dedupe / cost summary
pytest
```

## Registry path caveat

`app/config.py` defaults `REGISTRY_PATH` to `../files/brain/sources_registry.json`. That mirror no longer exists in the current layout. Set it explicitly when running the backend:

```env
REGISTRY_PATH=../frontend/data/sources_registry.json
```

Keep that runtime registry as the single source of truth. Do not hand-maintain a second registry unless you also verify byte-for-byte parity.

## Rules

- Real data only — no synthetic or seed jobs in production.
- `USER_AGENT` must identify the bot with a real URL and contact email.
- Blocklisted domains are never fetched directly; licensed feed URLs are link-back-only.
- Keys come from env or the encrypted vault. Never paste a key into chat, a ticket, or a commit.
