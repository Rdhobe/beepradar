from .config import env_keys_present, source_config
from .db import db
from .httpclient import QuotaClient
from .pipeline import expire_stale, ingest_raw_jobs
from .quota import QuotaTracker, RateLimited, apply_backoff, clear_backoff, iso, utcnow
from .sources import get_adapter


def run_source(source_id: str, limit: int | None = None) -> dict:
    source = source_config(source_id)
    if not source:
        return {"source": source_id, "status": "unknown_source"}
    if not source.get("enabled", False):
        return {"source": source_id, "status": "disabled"}
    if not env_keys_present(source):
        return {"source": source_id, "status": "skipped_no_key"}
    adapter = get_adapter(source)
    if adapter is None:
        return {"source": source_id, "status": "no_adapter"}

    with db() as conn:
        state = conn.execute("SELECT backoff_until FROM source_state WHERE source_id=?", (source_id,)).fetchone()
        if state and state["backoff_until"] and state["backoff_until"] > iso(utcnow()):
            return {"source": source_id, "status": "backoff", "until": state["backoff_until"]}
        tracker = QuotaTracker(conn, source)
        if tracker.requests_left_this_run() <= 0:
            return {"source": source_id, "status": "quota_exhausted", "remaining": tracker.remaining()}
        client = QuotaClient(conn, source, tracker)
        try:
            raw_jobs = adapter.fetch(client, limit)
            counts = ingest_raw_jobs(conn, source_id, raw_jobs)
            clear_backoff(conn, source_id)
            conn.execute(
                "INSERT INTO source_state (source_id, last_run_at, last_status) VALUES (?,?,?) "
                "ON CONFLICT(source_id) DO UPDATE SET last_run_at=excluded.last_run_at, last_status=excluded.last_status",
                (source_id, iso(utcnow()), "ok"),
            )
            conn.commit()
            return {"source": source_id, "status": "ok", **counts}
        except RateLimited as e:
            until = apply_backoff(conn, source_id, e.retry_after_s)
            return {"source": source_id, "status": "rate_limited", "backoff_until": until}
        except Exception as e:
            conn.execute(
                "INSERT INTO source_state (source_id, last_run_at, last_status) VALUES (?,?,?) "
                "ON CONFLICT(source_id) DO UPDATE SET last_run_at=excluded.last_run_at, last_status=excluded.last_status",
                (source_id, iso(utcnow()), f"error: {str(e)[:200]}"),
            )
            conn.commit()
            return {"source": source_id, "status": "error", "error": str(e)[:300]}
        finally:
            client.close()


def run_due_sources() -> list[dict]:
    from .scheduler import due_sources

    results = []
    for source_id in due_sources():
        results.append(run_source(source_id))
    with db() as conn:
        expired = expire_stale(conn)
    if expired:
        print(f"expired {expired} stale jobs")
    return results