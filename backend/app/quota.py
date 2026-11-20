import math
import sqlite3
from datetime import datetime, timedelta, timezone


class QuotaExhausted(Exception):
    pass


class RateLimited(Exception):
    def __init__(self, retry_after_s: float | None = None):
        self.retry_after_s = retry_after_s
        super().__init__(f"429 rate limited (retry after {retry_after_s}s)")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def window_keys(now: datetime) -> dict[str, str]:
    return {
        "minute": "m:" + now.strftime("%Y-%m-%dT%H:%M"),
        "hour": "h:" + now.strftime("%Y-%m-%dT%H"),
        "day": "d:" + now.strftime("%Y-%m-%d"),
        "week": "w:" + now.strftime("%G-W%V"),
        "month": "M:" + now.strftime("%Y-%m"),
    }


def _parse_quotas(source: dict, safety: float) -> dict[str, int]:
    """Effective per-window caps from documented quotas + schedule budgets."""
    caps: dict[str, int] = {}
    for q in source.get("limits", {}).get("quotas", []):
        n, per = q.get("n"), q.get("per")
        if not n or per in ("concurrent", "none", None):
            continue
        level = source.get("limits", {}).get("level", "unknown")
        margin = 0.9 if level == "official" else safety
        if per == "40s":
            cap = int(math.floor(n * 60 / 40 * margin))
            caps["minute"] = min(caps.get("minute", cap), cap)
        elif per in ("minute", "hour", "day", "week", "month"):
            cap = max(1, int(math.floor(n * margin)))
            caps[per] = min(caps.get(per, cap), cap)
    sched = source.get("schedule", {})
    if sched.get("daily_budget"):
        caps["day"] = min(caps.get("day", sched["daily_budget"]), sched["daily_budget"])
    if sched.get("monthly_budget"):
        caps["month"] = min(caps.get("month", sched["monthly_budget"]), sched["monthly_budget"])
    return caps


class QuotaTracker:
    def __init__(self, conn: sqlite3.Connection, source: dict, safety: float = 0.8):
        self.conn = conn
        self.source_id = source["id"]
        self.caps = _parse_quotas(source, safety)
        self.max_per_run = source.get("schedule", {}).get("max_requests_per_run", 50)
        row = conn.execute(
            "SELECT budget_override FROM source_state WHERE source_id=?", (self.source_id,)
        ).fetchone()
        if row and row["budget_override"] is not None and "day" in self.caps:
            self.caps["day"] = min(self.caps["day"], row["budget_override"])
        self.run_requests = 0

    def _usage(self, keys: dict[str, str]) -> dict[str, int]:
        rows = self.conn.execute(
            "SELECT window, count FROM source_quota_usage WHERE source_id=? AND window IN ({})".format(
                ",".join("?" * len(keys))
            ),
            [self.source_id, *keys.values()],
        ).fetchall()
        used = {r["window"]: r["count"] for r in rows}
        return {w: used.get(k, 0) for w, k in keys.items()}

    def remaining(self) -> dict[str, int]:
        keys = window_keys(utcnow())
        used = self._usage(keys)
        return {w: cap - used.get(w, 0) for w, cap in self.caps.items()}

    def can_request(self) -> bool:
        if self.run_requests >= self.max_per_run:
            return False
        return all(v > 0 for v in self.remaining().values())

    def record_request(self) -> None:
        keys = window_keys(utcnow())
        for key in keys.values():
            self.conn.execute(
                "INSERT INTO source_quota_usage (source_id, window, count) VALUES (?,?,1) "
                "ON CONFLICT(source_id, window) DO UPDATE SET count = count + 1",
                (self.source_id, key),
            )
        self.conn.commit()
        self.run_requests += 1

    def requests_left_this_run(self) -> int:
        rem = self.remaining()
        return max(0, min([self.max_per_run - self.run_requests, *rem.values()]))


def apply_backoff(conn: sqlite3.Connection, source_id: str, retry_after_s: float | None) -> str:
    row = conn.execute(
        "SELECT consecutive_429, budget_override FROM source_state WHERE source_id=?", (source_id,)
    ).fetchone()
    streak = (row["consecutive_429"] if row else 0) + 1
    hours = min(24, 2 ** (streak - 1))
    delay = timedelta(seconds=retry_after_s) if retry_after_s else timedelta(hours=hours)
    until = iso(utcnow() + delay)
    override = None
    if streak >= 3:
        current = row["budget_override"] if row and row["budget_override"] else None
        from .config import source_config
        base = current or source_config(source_id).get("schedule", {}).get("daily_budget", 100)
        override = max(1, base // 2)
    conn.execute(
        "INSERT INTO source_state (source_id, backoff_until, consecutive_429, budget_override, last_status) "
        "VALUES (?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET backoff_until=excluded.backoff_until, "
        "consecutive_429=excluded.consecutive_429, budget_override=excluded.budget_override, "
        "last_status=excluded.last_status",
        (source_id, until, streak, override, "backoff_429"),
    )
    conn.commit()
    return until


def clear_backoff(conn: sqlite3.Connection, source_id: str) -> None:
    conn.execute(
        "UPDATE source_state SET consecutive_429=0, backoff_until=NULL WHERE source_id=?", (source_id,)
    )
    conn.commit()