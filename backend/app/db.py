import sqlite3
from contextlib import contextmanager

from . import config

SCHEMA = """
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS jobs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source          TEXT NOT NULL,
  source_id       TEXT,
  canonical_url   TEXT NOT NULL UNIQUE,
  apply_url       TEXT,
  title           TEXT NOT NULL,
  company         TEXT NOT NULL,
  location_raw    TEXT,
  description     TEXT,
  posted_at       TEXT,
  first_seen_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  is_active       INTEGER NOT NULL DEFAULT 1,
  fingerprint     TEXT NOT NULL UNIQUE,
  is_india        INTEGER NOT NULL,
  is_fresher      INTEGER,
  tag_status      TEXT NOT NULL DEFAULT 'pending',
  role            TEXT,
  city            TEXT,
  job_type        TEXT,
  tag_confidence  REAL,
  tagged_at       TEXT,
  tag_model       TEXT
);
CREATE INDEX IF NOT EXISTS jobs_filter_idx ON jobs (is_active, role, city, posted_at DESC);
CREATE INDEX IF NOT EXISTS jobs_tag_idx ON jobs (tag_status, first_seen_at);
CREATE INDEX IF NOT EXISTS jobs_seen_idx ON jobs (last_seen_at);

CREATE VIRTUAL TABLE IF NOT EXISTS jobs_fts USING fts5(
  title, company, description, content='jobs', content_rowid='id'
);
CREATE TRIGGER IF NOT EXISTS jobs_ai AFTER INSERT ON jobs BEGIN
  INSERT INTO jobs_fts(rowid, title, company, description)
  VALUES (new.id, new.title, new.company, coalesce(new.description,''));
END;
CREATE TRIGGER IF NOT EXISTS jobs_ad AFTER DELETE ON jobs BEGIN
  INSERT INTO jobs_fts(jobs_fts, rowid, title, company, description)
  VALUES ('delete', old.id, old.title, old.company, coalesce(old.description,''));
END;
CREATE TRIGGER IF NOT EXISTS jobs_au AFTER UPDATE ON jobs BEGIN
  INSERT INTO jobs_fts(jobs_fts, rowid, title, company, description)
  VALUES ('delete', old.id, old.title, old.company, coalesce(old.description,''));
  INSERT INTO jobs_fts(rowid, title, company, description)
  VALUES (new.id, new.title, new.company, coalesce(new.description,''));
END;

CREATE TABLE IF NOT EXISTS job_sources_seen (
  job_id  INTEGER NOT NULL REFERENCES jobs(id),
  source  TEXT NOT NULL,
  url     TEXT NOT NULL,
  seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (job_id, source, url)
);

CREATE TABLE IF NOT EXISTS ingest_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source          TEXT NOT NULL,
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  fetched         INTEGER DEFAULT 0,
  passed_filter   INTEGER DEFAULT 0,
  inserted        INTEGER DEFAULT 0,
  dup_url         INTEGER DEFAULT 0,
  dup_fingerprint INTEGER DEFAULT 0,
  dup_fuzzy       INTEGER DEFAULT 0,
  error           TEXT
);

CREATE TABLE IF NOT EXISTS llm_runs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  model               TEXT,
  batch_size          INTEGER,
  input_tokens        INTEGER,
  output_tokens       INTEGER,
  cached_input_tokens INTEGER DEFAULT 0,
  latency_ms          INTEGER,
  ok                  INTEGER,
  retry_of            INTEGER,
  error               TEXT
);

CREATE TABLE IF NOT EXISTS source_quota_usage (
  source_id TEXT NOT NULL,
  window    TEXT NOT NULL,
  count     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (source_id, window)
);

CREATE TABLE IF NOT EXISTS source_state (
  source_id        TEXT PRIMARY KEY,
  last_run_at      TEXT,
  next_due_at      TEXT,
  backoff_until    TEXT,
  consecutive_429  INTEGER NOT NULL DEFAULT 0,
  budget_override  INTEGER,
  last_status      TEXT,
  verified_at      TEXT
);

CREATE TABLE IF NOT EXISTS http_cache (
  url           TEXT PRIMARY KEY,
  etag          TEXT,
  last_modified TEXT,
  fetched_at    TEXT
);
"""


def connect() -> sqlite3.Connection:
    config.DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(config.DATABASE_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    conn = connect()
    try:
        conn.executescript(SCHEMA)
        conn.commit()
    finally:
        conn.close()


@contextmanager
def db():
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()