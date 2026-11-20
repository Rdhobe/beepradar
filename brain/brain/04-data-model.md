# 04 — Data model & taxonomy

> **As-built.** The canonical schema is `frontend/lib/db/schema.sql` (run once in
> the Supabase SQL Editor, or `npm run db:push` with `DATABASE_URL`). No Drizzle.
> Jobs carry `company_norm`/`title_norm` for dedupe, are **rule-tagged at ingest**
> (`tag_model='rule-v1'`, `tag_status='done'`), and **store raw HTML** in
> `description` (cleaned at the read layer only). Source scheduling/cooldown,
> quotas, HTTP cache, admin registry patches and encrypted secrets each have a
> table. `source_state.next_due_at` doubles as the **6 h cooldown** stamp.

## SQL (mirrors `frontend/lib/db/schema.sql`)
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE jobs (
  id              BIGSERIAL PRIMARY KEY,
  source          TEXT NOT NULL,              -- adzuna_in, greenhouse, ...
  source_id       TEXT,                       -- id in the source system
  canonical_url   TEXT NOT NULL,              -- tracking params stripped
  apply_url       TEXT,
  title           TEXT NOT NULL,
  company         TEXT NOT NULL,
  company_norm    TEXT NOT NULL,              -- normalized for dedupe
  title_norm      TEXT NOT NULL,              -- normalized for fuzzy dedupe
  location_raw    TEXT,
  description     TEXT,                       -- RAW HTML kept; cleaned at read layer only
  posted_at       TIMESTAMPTZ,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active       BOOLEAN NOT NULL DEFAULT true,

  -- derived (deterministic)
  fingerprint     TEXT NOT NULL,              -- sha1(norm(company)|norm(title)|city_guess)
  is_india        BOOLEAN NOT NULL,
  is_fresher      BOOLEAN,                    -- heuristic at ingest, LLM may confirm

  -- tags (rule-v1 at ingest by default; LLM override optional)
  tag_status      TEXT NOT NULL DEFAULT 'pending',  -- pending | done | failed
  role            TEXT,                       -- enum below
  city            TEXT,                       -- enum below
  job_type        TEXT,                       -- internship | fresher_fulltime | apprenticeship | other
  tag_confidence  REAL,
  tagged_at       TIMESTAMPTZ,
  tag_model       TEXT,                       -- 'rule-v1' (free) or the configured LLM model id

  search_tsv      TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(company,'')), 'B') ||
    setweight(to_tsvector('english', coalesce(description,'')), 'C')
  ) STORED,

  UNIQUE (canonical_url),
  UNIQUE (fingerprint)
);
CREATE INDEX jobs_tsv_idx    ON jobs USING GIN (search_tsv);
CREATE INDEX jobs_title_trgm ON jobs USING GIN (title_norm gin_trgm_ops);
CREATE INDEX jobs_filter_idx ON jobs (is_active, role, city, posted_at DESC);
CREATE INDEX jobs_tag_idx    ON jobs (tag_status, first_seen_at);
CREATE INDEX jobs_company_idx ON jobs (company_norm);
CREATE INDEX jobs_seen_idx   ON jobs (last_seen_at);

CREATE TABLE job_sources_seen (          -- same job seen via multiple sources (shows dedupe working)
  job_id BIGINT REFERENCES jobs(id), source TEXT, url TEXT, seen_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (job_id, source, url)
);

CREATE TABLE ingest_runs (
  id BIGSERIAL PRIMARY KEY, source TEXT, started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ,
  fetched INT, passed_filter INT, inserted INT, dup_url INT, dup_fingerprint INT, dup_fuzzy INT, error TEXT
);

CREATE TABLE llm_runs (                  -- THE source of the cost-per-1,000 number
  id BIGSERIAL PRIMARY KEY, ran_at TIMESTAMPTZ DEFAULT now(), model TEXT,
  batch_size INT, input_tokens INT, output_tokens INT, cached_input_tokens INT DEFAULT 0,
  latency_ms INT, ok BOOLEAN, retry_of BIGINT, error TEXT
);

-- Per-source scheduling state. next_due_at doubles as the 6h COOLDOWN stamp:
-- set to now()+6h on every run attempt; runSource/scheduler skip while future.
CREATE TABLE source_state (
  source_id        TEXT PRIMARY KEY,
  last_run_at      TIMESTAMPTZ,
  next_due_at      TIMESTAMPTZ,          -- cooldown until (also next due)
  backoff_until    TIMESTAMPTZ,          -- 429 exponential backoff
  consecutive_429  INT NOT NULL DEFAULT 0,
  budget_override  INT,
  last_status      TEXT,
  verified_at      TIMESTAMPTZ
);

CREATE TABLE source_quota_usage (        -- per-source daily quota counter
  source_id TEXT NOT NULL, quota_window TEXT NOT NULL,  -- e.g. 'd:2026-11-20'
  count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (source_id, quota_window)
);

CREATE TABLE http_cache (                -- ETag/Last-Modified politeness cache
  url TEXT PRIMARY KEY, etag TEXT, last_modified TEXT,
  fetched_at TIMESTAMPTZ DEFAULT now()
);

-- Admin patches over the built-in JSON registry + user-added sources.
-- patch  = deep-merged onto a built-in config (enabled, schedule, limits, tokens…)
-- custom = full SourceConfig for a user-added source (api.adapter selects logic)
CREATE TABLE source_admin (
  source_id TEXT PRIMARY KEY, patch JSONB, custom JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Encrypted API keys, global by name (shared across sources). Ciphertext only:
-- AES-256-GCM; master key lives in SOURCE_KEYS_SECRET env var.
CREATE TABLE integration_secrets (
  key_name TEXT PRIMARY KEY, ciphertext TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Single-row admin tagging config (mode/provider/model). Read over the wire by
// resolveTaggingConfig(); env (LLM_PROVIDER/LLM_MODEL/TAG_MODE) is the fallback.
-- Provider API keys are NOT stored here — they live in integration_secrets.
CREATE TABLE tagging_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  mode TEXT NOT NULL DEFAULT 'free' CHECK (mode IN ('free','llm')),
  provider TEXT NOT NULL DEFAULT 'groq' CHECK (provider IN ('groq','openai','anthropic')),
  model TEXT NOT NULL DEFAULT 'openai/gpt-oss-20b',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO tagging_config (id) VALUES (1) ON CONFLICT DO NOTHING;
```

## Role taxonomy (closed enum — 20 roles, shared by the rule tagger and the LLM)
`software_engineering`, `frontend`, `backend`, `fullstack`, `mobile`, `data_analytics`, `data_science_ml`, `devops_cloud`, `qa_testing`, `product_management`, `design_ux`, `marketing`, `sales_bizdev`, `content_writing`, `hr_recruiting`, `finance_accounting`, `operations_supply_chain`, `customer_support`, `core_engineering` (mech/civil/electrical), `other`

> Tip: if accuracy on the 50-post check is poor, **collapse** frontend/backend/fullstack into `software_engineering` and report both versions — a good talking point.

## City taxonomy
`Bengaluru`, `Mumbai`, `Delhi_NCR` (Delhi, Gurugram, Noida, Faridabad, Ghaziabad), `Hyderabad`, `Pune`, `Chennai`, `Kolkata`, `Ahmedabad`, `Jaipur`, `Chandigarh`, `Kochi`, `Indore`, `Other_India`, `Remote_India`, `Multiple`, `Unknown`

Deterministic gazetteer in `lib/cities.ts` (aliases: Bangalore/Bengaluru/Bengaluru Urban → Bengaluru; Gurgaon/Gurugram → Delhi_NCR; Bombay/Navi Mumbai/Thane → Mumbai; etc.). Used for (a) `fingerprint`, (b) pre-filtering non-India, (c) **cross-checking LLM city** — mismatch rate is a useful metric.
