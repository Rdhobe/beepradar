-- BeepRadar schema for Supabase Postgres.
-- Run once in Supabase SQL Editor (or: npm run db:push with DATABASE_URL set).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS jobs (
  id              BIGSERIAL PRIMARY KEY,
  source          TEXT NOT NULL,
  source_id       TEXT,
  canonical_url   TEXT NOT NULL,
  apply_url       TEXT,
  title           TEXT NOT NULL,
  company         TEXT NOT NULL,
  company_norm    TEXT NOT NULL,
  title_norm      TEXT NOT NULL,
  location_raw    TEXT,
  description     TEXT,
  posted_at       TIMESTAMPTZ,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  fingerprint     TEXT NOT NULL,
  is_india        BOOLEAN NOT NULL,
  is_fresher      BOOLEAN,
  tag_status      TEXT NOT NULL DEFAULT 'pending',
  role            TEXT,
  city            TEXT,
  job_type        TEXT,
  tag_confidence  REAL,
  tagged_at       TIMESTAMPTZ,
  tag_model       TEXT,
  search_tsv      TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(company,'')), 'B') ||
    setweight(to_tsvector('english', coalesce(description,'')), 'C')
  ) STORED,
  UNIQUE (canonical_url),
  UNIQUE (fingerprint)
);
CREATE INDEX IF NOT EXISTS jobs_tsv_idx    ON jobs USING GIN (search_tsv);
CREATE INDEX IF NOT EXISTS jobs_title_trgm ON jobs USING GIN (title_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS jobs_filter_idx ON jobs (is_active, role, city, posted_at DESC);
CREATE INDEX IF NOT EXISTS jobs_tag_idx    ON jobs (tag_status, first_seen_at);
CREATE INDEX IF NOT EXISTS jobs_company_idx ON jobs (company_norm);
CREATE INDEX IF NOT EXISTS jobs_seen_idx   ON jobs (last_seen_at);

CREATE TABLE IF NOT EXISTS job_sources_seen (
  job_id  BIGINT REFERENCES jobs(id),
  source  TEXT,
  url     TEXT,
  seen_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (job_id, source, url)
);

CREATE TABLE IF NOT EXISTS ingest_runs (
  id              BIGSERIAL PRIMARY KEY,
  source          TEXT,
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  fetched         INT DEFAULT 0,
  passed_filter   INT DEFAULT 0,
  inserted        INT DEFAULT 0,
  dup_url         INT DEFAULT 0,
  dup_fingerprint INT DEFAULT 0,
  dup_fuzzy       INT DEFAULT 0,
  error           TEXT
);

CREATE TABLE IF NOT EXISTS llm_runs (
  id                  BIGSERIAL PRIMARY KEY,
  ran_at              TIMESTAMPTZ DEFAULT now(),
  model               TEXT,
  batch_size          INT,
  input_tokens        INT,
  output_tokens       INT,
  cached_input_tokens INT DEFAULT 0,
  latency_ms          INT,
  ok                  BOOLEAN,
  retry_of            BIGINT,
  error               TEXT
);

CREATE TABLE IF NOT EXISTS source_quota_usage (
  source_id    TEXT NOT NULL,
  quota_window TEXT NOT NULL,
  count        INT NOT NULL DEFAULT 0,
  PRIMARY KEY (source_id, quota_window)
);

CREATE TABLE IF NOT EXISTS source_state (
  source_id        TEXT PRIMARY KEY,
  last_run_at      TIMESTAMPTZ,
  next_due_at      TIMESTAMPTZ,
  backoff_until    TIMESTAMPTZ,
  consecutive_429  INT NOT NULL DEFAULT 0,
  budget_override  INT,
  last_status      TEXT,
  verified_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS http_cache (
  url           TEXT PRIMARY KEY,
  etag          TEXT,
  last_modified TEXT,
  fetched_at    TIMESTAMPTZ DEFAULT now()
);

-- Admin panel: patches over the built-in JSON registry + user-added sources.
-- patch  = deep-merged onto a built-in source config (enabled, schedule, limits, api tokens…)
-- custom = full SourceConfig for a user-added source (api.adapter selects the adapter logic)
CREATE TABLE IF NOT EXISTS source_admin (
  source_id  TEXT PRIMARY KEY,
  patch      JSONB,
  custom     JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Encrypted API keys, global by name (shared across sources).
-- Ciphertext only: AES-256-GCM, master key lives in SOURCE_KEYS_SECRET env var.
CREATE TABLE IF NOT EXISTS integration_secrets (
  key_name   TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Single-row admin tagging config (mode/provider/model). Provider API keys live
-- in integration_secrets, not here. Read over the wire by resolveTaggingConfig().
CREATE TABLE IF NOT EXISTS tagging_config (
  id         INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  mode       TEXT NOT NULL DEFAULT 'free' CHECK (mode IN ('free','llm')),
  provider   TEXT NOT NULL DEFAULT 'groq' CHECK (provider IN ('groq','openai','anthropic')),
  model      TEXT NOT NULL DEFAULT 'openai/gpt-oss-20b',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO tagging_config (id) VALUES (1) ON CONFLICT DO NOTHING;