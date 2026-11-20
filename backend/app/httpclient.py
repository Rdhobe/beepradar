import os
import sqlite3
import time
from urllib.parse import urlsplit

import httpx

from .config import USER_AGENT
from .quota import QuotaExhausted, QuotaTracker, RateLimited


class QuotaClient:
    """HTTP client that enforces quota before EVERY request, per-host delays,
    ETag/Last-Modified caching, and 429 escalation."""

    def __init__(self, conn: sqlite3.Connection, source: dict, tracker: QuotaTracker):
        self.conn = conn
        self.tracker = tracker
        self.delay_s = source.get("schedule", {}).get("request_delay_s", 3)
        self.timeout = source.get("limits", {}).get("timeout_s", 15)
        self._last_request: dict[str, float] = {}
        self._client = httpx.Client(
            headers={"User-Agent": USER_AGENT, "Accept": "application/json, text/xml, application/xml, */*"},
            timeout=self.timeout,
            follow_redirects=True,
            trust_env=False,
            proxy=os.getenv("HTTPS_PROXY") or os.getenv("HTTP_PROXY") or None,
        )

    def close(self):
        self._client.close()

    def _wait_for_host(self, url: str):
        host = urlsplit(url).netloc
        last = self._last_request.get(host, 0)
        wait = self.delay_s - (time.monotonic() - last)
        if wait > 0:
            time.sleep(wait)
        self._last_request[host] = time.monotonic()

    def request(self, method: str, url: str, *, use_cache: bool = False, **kwargs) -> httpx.Response | None:
        if not self.tracker.can_request():
            raise QuotaExhausted(f"{self.tracker.source_id}: quota or run budget exhausted")
        headers = dict(kwargs.pop("headers", {}))
        if use_cache:
            row = self.conn.execute("SELECT etag, last_modified FROM http_cache WHERE url=?", (url,)).fetchone()
            if row:
                if row["etag"]:
                    headers["If-None-Match"] = row["etag"]
                if row["last_modified"]:
                    headers["If-Modified-Since"] = row["last_modified"]
        self._wait_for_host(url)
        self.tracker.record_request()
        resp = self._client.request(method, url, headers=headers, **kwargs)
        if resp.status_code == 429:
            retry_after = resp.headers.get("Retry-After")
            seconds = None
            if retry_after:
                try:
                    seconds = float(retry_after)
                except ValueError:
                    seconds = 3600
            raise RateLimited(seconds)
        if use_cache:
            if resp.status_code == 304:
                return None
            if resp.status_code == 200:
                self.conn.execute(
                    "INSERT INTO http_cache (url, etag, last_modified, fetched_at) VALUES (?,?,?,datetime('now')) "
                    "ON CONFLICT(url) DO UPDATE SET etag=excluded.etag, last_modified=excluded.last_modified, "
                    "fetched_at=excluded.fetched_at",
                    (url, resp.headers.get("ETag"), resp.headers.get("Last-Modified")),
                )
                self.conn.commit()
        return resp

    def get(self, url: str, **kwargs) -> httpx.Response | None:
        return self.request("GET", url, **kwargs)

    def post(self, url: str, **kwargs) -> httpx.Response | None:
        return self.request("POST", url, **kwargs)

    def get_json(self, url: str, **kwargs):
        resp = self.get(url, **kwargs)
        if resp is None:
            return None
        resp.raise_for_status()
        return resp.json()