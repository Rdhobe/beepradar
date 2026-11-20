from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from croniter import croniter

from .config import env_keys_present, registry_sources
from .db import db
from .quota import QuotaTracker, iso, utcnow
from .sources import get_adapter

_executor = ThreadPoolExecutor(max_workers=2)


def _update_next_due(source_id: str, cron: str) -> None:
    nxt = croniter(cron, datetime.now(timezone.utc)).get_next(datetime)
    with db() as conn:
        conn.execute(
            "INSERT INTO source_state (source_id, next_due_at) VALUES (?,?) "
            "ON CONFLICT(source_id) DO UPDATE SET next_due_at=excluded.next_due_at",
            (source_id, iso(nxt)),
        )


def due_sources() -> list[str]:
    now = iso(utcnow())
    due = []
    with db() as conn:
        for source in registry_sources():
            if not source.get("enabled") or not env_keys_present(source):
                continue
            if source.get("schedule", {}).get("max_requests_per_run", 0) <= 0:
                continue
            if get_adapter(source) is None:
                continue
            state = conn.execute(
                "SELECT next_due_at, backoff_until FROM source_state WHERE source_id=?",
                (source["id"],),
            ).fetchone()
            if state and state["backoff_until"] and state["backoff_until"] > now:
                continue
            if state and state["next_due_at"] and state["next_due_at"] > now:
                continue
            if QuotaTracker(conn, source).requests_left_this_run() <= 0:
                continue
            due.append(source["id"])
    return due


def _run_and_reschedule(source_id: str, cron: str) -> None:
    from .runner import run_source

    result = run_source(source_id)
    print(f"[scheduler] {result}")
    _update_next_due(source_id, cron)


def tick() -> None:
    crons = {s["id"]: s.get("schedule", {}).get("cron", "0 0 * * *") for s in registry_sources()}
    for source_id in due_sources():
        _executor.submit(_run_and_reschedule, source_id, crons[source_id])


def start_scheduler() -> None:
    from apscheduler.schedulers.blocking import BlockingScheduler

    from .db import init_db

    init_db()
    scheduler = BlockingScheduler()
    scheduler.add_job(tick, "cron", minute="*/15", id="ingest_tick")
    scheduler.add_job(tick, "date", id="startup_tick")
    print("scheduler started — tick every 15 min, max 2 concurrent sources")
    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        _executor.shutdown(wait=False)