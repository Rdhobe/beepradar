import argparse
import json

from .db import init_db


def main():
    parser = argparse.ArgumentParser(prog="beepradar", description="BeepRadar Python backend")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("init", help="create SQLite schema")

    p_ingest = sub.add_parser("ingest", help="run source adapters now (quota still enforced)")
    p_ingest.add_argument("--source", help="single source id from the registry")
    p_ingest.add_argument("--due", action="store_true", help="run only cron-due sources")
    p_ingest.add_argument("--all", action="store_true", help="run all enabled sources with keys")
    p_ingest.add_argument("--limit", type=int, help="cap raw jobs per source")

    sub.add_parser("scheduler", help="start the 15-min quota-aware scheduler loop")

    p_tag = sub.add_parser("tag", help="drain pending LLM tagging queue")
    p_tag.add_argument("--batches", type=int, default=10)

    sub.add_parser("serve", help="start FastAPI server")
    sub.add_parser("probe", help="probe ATS boards for India-hiring tokens")
    sub.add_parser("stats", help="print ingest/dedupe/cost summary")

    args = parser.parse_args()
    init_db()

    if args.cmd == "init":
        print("database initialized")
    elif args.cmd == "ingest":
        from .runner import run_due_sources, run_source
        from .config import env_keys_present, registry_sources

        if args.source:
            print(json.dumps(run_source(args.source, args.limit), indent=2))
        elif args.due:
            for r in run_due_sources():
                print(json.dumps(r))
        elif args.all:
            for s in registry_sources():
                if s.get("enabled") and env_keys_present(s):
                    print(json.dumps(run_source(s["id"], args.limit)))
        else:
            parser.error("choose --source, --due or --all")
    elif args.cmd == "scheduler":
        from .scheduler import start_scheduler

        start_scheduler()
    elif args.cmd == "tag":
        from .tagger import tag_pending

        print(json.dumps(tag_pending(args.batches), indent=2))
    elif args.cmd == "serve":
        import uvicorn

        from .config import API_HOST, API_PORT

        uvicorn.run("app.api:app", host=API_HOST, port=API_PORT, reload=False)
    elif args.cmd == "probe":
        from scripts.probe_boards import main as probe_main

        probe_main()
    elif args.cmd == "stats":
        from .api import stats

        print(json.dumps(stats(), indent=2))


if __name__ == "__main__":
    main()