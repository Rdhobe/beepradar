# 06 — Tagging (rule-first, free · LLM optional)

> **As-built change.** Tagging is no longer LLM-first or cron-driven. Every job is
> **rule-tagged at ingest** (deterministic, zero cost) so it is immediately
> filterable by role / city / type / fresher. The LLM pass is an **optional
> override** you trigger by hand from `/admin`. There is no cron.

## Two taggers, one schema

| | Rule tagger (default) | LLM tagger (optional) |
|---|---|---|
| Code | `lib/rule_tagger.ts` → `tagJob()` | `lib/tagger.ts` → `tagPending()` |
| When | **At INSERT**, inside the ingest pipeline | On demand, drains `pending` (+ optionally `rule-v1`) |
| Cost | ₹0 / $0 — no API call | Provider tokens (Groq / OpenAI / Anthropic), logged to `llm_runs` |
| `tag_model` | `rule-v1` | the configured model (e.g. `openai/gpt-oss-20b`) |
| `tag_status` after | `done` (set in the same INSERT) | `done`, or `failed` after a repair retry |
| Needs a key | No | provider key (`GROQ_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`), else `skipped_no_key` |
| Output fields | role, city, job_type, is_fresher, confidence | same |

Both write the **same columns** (`role`, `city`, `job_type`, `is_fresher`,
`tag_confidence`, `tagged_at`, `tag_model`, `tag_status`), so the search UI and
filters do not care which tagger produced a row.

## A. Rule tagger (how new data is tagged)

`tagJob({title, company, locationRaw, description})` is pure and deterministic:

- **role** — `classifyRole()`: **title-priority scoring**. Every role gets
  `score = 3 × titleHits + min(descHits, 4)`. Roles with **any title hit form the
  candidate pool** — description evidence can only re-rank within that pool, so
  company boilerplate (e.g. Stripe's repeated "growth" marketing copy) can never
  outvote a "Software Engineer" title. Only when **no** role matches the title
  does the description decide (fallback pool, desc still capped at 4). Specific
  roles win ties against the generic `software_engineering` bucket (ROLE_ORDER).
  No evidence → `other` (confidence 0.4). Confidence rises with score and with a
  clear winner, capped at 0.95. Keyword hygiene: bare "growth" was removed from
  marketing (replaced by "growth marketing/intern/analyst/associate/manager/
  hacker"); "ml engineering" added to data_science_ml.
  *Fixed the false MARKETING tag on SWE titles (#35–#38 etc.); verified read-only
  against the live DB: 5 of 41 rows change role under the fixed rules.*
- **city** — `classifyCity()`: the `lib/cities.ts` gazetteer on `location_raw`,
  falling back to the first ~600 chars of description; anything unrecognized →
  `Unknown`. Never guesses a city not in the text.
- **job_type** — `classifyJobType()`: `apprentice*` → apprenticeship, `intern*`
  → internship, else fresher → `fresher_fulltime`, else `other`.
- **is_fresher** — `fresherHeuristic()` from `lib/prefilter.ts` (keywords +
  parsed experience ≤ 1 yr; rejects senior/lead/5+ yrs).

**Where it runs:** `lib/pipeline.ts` calls `tagJob()` for every candidate that
passes the pre-filter, then INSERTs the row already carrying
`tag_status='done'`, `tag_model='rule-v1'`, `tagged_at=now()`. New jobs are
tagged the moment they are stored — no queue, no wait, no tokens.

## B. Backfill (how previous data is tagged)

Rows ingested **before** rule tagging existed — or left `pending`/`failed` by an
LLM pass — are backfilled by `ruleTagUntagged(batchSize=400, maxBatches=20,
reapply=false)`:

```sql
-- selection (per batch), default
SELECT id, title, company, location_raw, description FROM jobs
WHERE tag_status <> 'done' OR role IS NULL
ORDER BY id LIMIT 400;
-- with reapply=true (re-score rule-tagged rows under the current rules):
WHERE tag_model = 'rule-v1' OR tag_status <> 'done' OR role IS NULL
```

**Re-apply** (`POST /api/admin/retag {reapply:true}`, admin button *“Re-apply
rules to rule-tagged →”*) re-runs the fixed classifier over rows already stamped
`rule-v1` — this is how the title-priority accuracy fix reaches **stored** data.
It never touches LLM-tagged rows (`tag_model` = a model id).

Each batch runs `tagJob()` in memory and applies **one set-based UPDATE** via
`jsonb_to_recordset(...) AS v(id bigint, role text, city text, job_type text,
is_fresher boolean, conf real)` — typed columns avoid the postgres.js
"could not determine data type of parameter" pitfall. It stamps
`tag_model='rule-v1'`, `tag_status='done'`. Up to 20 × 400 = 8,000 rows per call;
re-run until it returns `tagged: 0`.

> **jsonb encoding fix (as-built).** The payload is passed as `${sql.json(payload)}`,
> **not** `${JSON.stringify(payload)}::jsonb`. postgres.js infers jsonb from the
> `::jsonb` cast and re-serializes an already-stringified string into a JSON
> *string scalar*, so `jsonb_to_recordset` threw `cannot call jsonb_to_recordset
> on a non-array` (22023) and the backfill tagged **0** rows. `sql.json()` encodes
> once. The same fix applies to the fuzzy-dedupe batch query in `lib/dedupe.ts`
> (`findFuzzyDuplicates`), which only fires on re-runs.

> The backfill uses the **exact same rules** as ingest, so old and new rows are
> tagged consistently. It only touches rows that are not already `done` with a
> role — it will not overwrite an LLM-tagged (`done`) row.

## C. LLM tagger (optional override, multi-provider)

`tagPending(maxBatches=10, budgetMs=50_000, includeRuleTagged=false)` resolves the
admin **tagging config** (`lib/llm_config.ts`), selects `tag_status='pending'`
ORDER BY `first_seen_at` (plus `tag_model='rule-v1'` rows when `includeRuleTagged`),
batches `LLM_BATCH_SIZE` (default 10) posts/call, calls the configured provider at
`temperature: 0`, validates with Zod, and on invalid output does **one repair
retry**; a second failure marks the batch `failed`. Every call (ok or not) writes
a `llm_runs` row with input/output/cached tokens + latency. Missing ids are left
`pending`. It also cross-checks LLM city vs the gazetteer and counts
`city_mismatches`.

**Providers** (`lib/llm_config.ts` → `PROVIDERS`, plain `fetch`, no SDK):

| Provider | Key env | Endpoint / shape | Default model | Presets |
|---|---|---|---|---|
| **Groq** (default) | `GROQ_API_KEY` | `api.groq.com/openai/v1/chat/completions` (OpenAI-compatible) | `openai/gpt-oss-20b` | `openai/gpt-oss-120b`, `llama-3.3-70b-versatile` |
| OpenAI (ChatGPT) | `OPENAI_API_KEY` | `api.openai.com/v1/chat/completions` | `gpt-4o-mini` | `gpt-4.1-mini`, `gpt-4o` |
| Anthropic (Claude) | `ANTHROPIC_API_KEY` | `api.anthropic.com/v1/messages` | `claude-haiku-5-5` | `claude-sonnet-4-5`, `claude-opus-4-1` |

- Groq + OpenAI send `response_format:{type:"json_object"}` and a `system` +
  `user` message. Groq uses `max_completion_tokens:8192`; **gpt-oss reasoning
  models** also get `reasoning_effort:"low"` + `include_reasoning:false` (reasoning
  tokens count toward the completion budget, so the budget is generous and the
  trace is excluded from the answer). OpenAI uses `max_tokens:4096`.
- Anthropic sends `system:[{type:"text",text:SYSTEM_PROMPT,cache_control:{type:"ephemeral"}}]`
  + `max_tokens:4096`, `x-api-key` / `anthropic-version: 2023-06-01` headers.
- Usage is normalized per provider (`parseProviderResponse`): OpenAI-compatible
  `prompt_tokens` / `completion_tokens` / `prompt_tokens_details.cached_tokens`;
  Anthropic `input_tokens` / `output_tokens` / `cache_read_input_tokens`.
- `parseTagResponse()` still regex-extracts the first `{…}` block before Zod, so
  prose/fence-wrapped JSON is tolerated regardless of provider.

Because ingest already rule-tags everything `done`, the pending queue is normally
**empty**. The admin LLM pass therefore defaults to `includeRuleTagged=true` so it
**upgrades the rule-tagged pool** with the model. Once a row is LLM-tagged its
`tag_model` is the model id (≠ `rule-v1`), so it drops out of the queue — no
infinite re-tagging.

### Configure (admin → Tagging → “Configure →”)

A single-row `tagging_config` table holds `{mode:'free'|'llm', provider, model}`.
The form **opens on click** (table/card is the default view):

- **Mode** — *Free (rules)* or *Paid (LLM)*. Free is the default; rule tagging at
  ingest happens regardless of mode.
- **Provider + model** (paid only) — dropdown of presets per provider plus a
  *Custom…* model id field.
- **API key** (paid only) — password field; saved **encrypted** into
  `integration_secrets` under the provider's key env name (needs
  `SOURCE_KEYS_SECRET`). Leave blank to keep the stored key. Env var is the
  fallback when no DB key is set.

Resolution order (`resolveTaggingConfig`): **DB row → env (`LLM_PROVIDER` /
`LLM_MODEL` / `TAG_MODE`) → built-in defaults** (`free`, `groq`,
`openai/gpt-oss-20b`). A legacy env that sets only `LLM_MODEL=claude-…` infers
`provider=anthropic` so the fallback stays coherent. Missing table / unreachable
DB never throws — the free path keeps working.

| Action | Endpoint | Body | Effect |
|---|---|---|---|
| **Save config** | `POST /api/admin/tagging` | `{mode, provider, model, api_key?}` | upserts `tagging_config`; if `api_key` present, `saveSecret(providerKeyEnv, …)` |

### Output schema (Zod)
```ts
const Tag = z.object({
  id: z.number().int(),
  role: z.enum(ROLES),
  city: z.enum(CITIES),
  job_type: z.enum(["internship","fresher_fulltime","apprenticeship","other"]),
  is_fresher: z.boolean(),
  confidence: z.number().min(0).max(1),
});
const Batch = z.object({ results: z.array(Tag) });
```

### System prompt (static, cache_control: ephemeral)
```
You label Indian job posts for a student career platform.
Return ONLY JSON: {"results":[{"id","role","city","job_type","is_fresher","confidence"}]}.

ROLE must be exactly one of: <ROLES list with one-line definitions>
CITY must be exactly one of: <CITIES list>.
City rules:
- Use the primary work location. Gurugram/Noida/Gurgaon/Delhi => Delhi_NCR. Bangalore => Bengaluru.
- Fully remote but India-eligible => Remote_India. Several cities listed => Multiple. Not stated => Unknown.
- Never guess a city that is not in the text.
ROLE rules:
- Choose by the day-to-day work, not the company's industry.
- If nothing fits => other.
job_type is one of: internship, fresher_fulltime, apprenticeship, other.
is_fresher = true if the post targets students/0–1 years/graduates/interns.
confidence = your honest 0–1 confidence in role AND city together.
Return one result per input id, no extras.
```
User message: N posts as `{id, title, company, location_raw, description[:cap]}` —
cap **700 chars on Groq free tier** (fits ~2 batches inside the 8K TPM window),
1,200 elsewhere.

## D. How to run tag analysis (admin endpoints + UI)

All tagging endpoints require admin auth (signed-in Supabase user whose email is
in `ADMIN_EMAILS`; Bearer access token). The `/admin` **Tagging** card wires them
up and shows live `pending / done / failed` counts, model, batch size, key
status, and the last 10 `llm_runs`.

| Action | Endpoint | Body | Effect |
|---|---|---|---|
| **Tag analysis / status** | `GET /api/admin/tagging` | — | counts by `tag_status`, recent `llm_runs`, `config {mode, provider, model, batch_size, key_env, api_key_present, key_source, key_masked, master_key_present}`, `providers[]` |
| **Save config** | `POST /api/admin/tagging` | `{mode, provider, model, api_key?}` | upserts `tagging_config` + optional encrypted key |
| **Rule-tag all untagged** (previous data) | `POST /api/admin/retag` | `{reapply?:bool}` | `ruleTagUntagged()` backfill, ₹0; `reapply:true` also re-scores `rule-v1` rows |
| **Tag** (mode-aware) | `POST /api/admin/tag` | `{max_batches?:1–50, include_rule_tagged?:bool}` | `mode='free'` → `ruleTagUntagged()`; `mode='llm'` → `tagPending()` (upgrades rule-tagged rows by default) |
| **Retry failed** (LLM) | `POST /api/admin/tag` | `{retry_failed:true, max_batches?}` | resets `failed`→`pending`, then `tagPending()` |

**From the UI (`/admin` → Tagging):**
- *Configure:* click **“Configure →”** (yellow) to open the form; pick Free/Paid,
  provider, model, paste the API key, **Save config**.
- *Previous data:* click **“Rule-tag all untagged (no LLM) →”** (green). Backfills
  every pending/failed/untagged row with the ingest rules. Zero tokens.
- *Fix stored rule tags after a classifier change:* click **“Re-apply rules to
  rule-tagged →”** (green, `{reapply:true}`). Re-scores all `rule-v1` rows under
  the current rules; LLM-tagged rows are untouched.
- *New data:* nothing to do — it is rule-tagged automatically during ingest.
- *Paid LLM:* in Paid mode set **Batches**, click **“Tag with GROQ/OPENAI/ANTHROPIC →”**
  (blue), or **“Retry failed”**. The blue button is disabled until the provider key
  is set; it upgrades pending + rule-tagged rows with the configured model.

**From the CLI (admin token in `$TOKEN`):**
```bash
curl -s -X POST http://localhost:3000/api/admin/retag -H "Authorization: Bearer $TOKEN"
curl -s http://localhost:3000/api/admin/tagging -H "Authorization: Bearer $TOKEN"
curl -s -X POST http://localhost:3000/api/admin/tag -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"max_batches":5}'
```

## E. Reliability tactics (LLM pass)
- `temperature: 0`; structured JSON; Zod validation; one repair retry then `failed`.
- Batch posts/call (system prompt amortized + cached); truncate descriptions
  (700 chars Groq / 1,200 others).
- Row-level fallback: ids missing from a batch result stay `pending`.
- Cross-check LLM city vs gazetteer; log disagreements → review set for the eval.
- Skip re-tagging `done` rows unless you intentionally reset them.

### Groq free-tier rate limiting (as-built, `lib/llm_config.ts` + `lib/tagger.ts`)
Free plan for gpt-oss-20b/120b: **RPM 30 · TPM 8,000 · RPD 1,000 · TPD 200,000**.
The tagger never blasts the API:

- **Sliding 60 s window** — `nextSlotDelay()` keeps process-local `recentCalls`
  timestamps + token estimates (`estimateRequestTokens` ≈ chars/4 + 90/post).
  Before each batch it waits until adding the call would stay under RPM **and**
  TPM; result `stopped_rate_window` when the budget can't fit.
- **Daily guard** — `llm_runs` is queried for today's call count + tokens for the
  configured model; at **95% RPD / 90% TPD** the pass returns
  `skipped_daily_limit` / `stopped_daily_limit` instead of burning the quota.
- **429 backoff** — on rate-limit the call sleeps `Retry-After` (default 20 s,
  capped 45 s) and retries **once**; a second 429 fails the batch gracefully.
- Overrides: `GROQ_RPM` / `GROQ_TPM` / `GROQ_RPD` / `GROQ_TPD` env ints.
- Practical effect: **~2 batches (≈20 posts) per 50 s admin click**; the admin
  card prints this expectation. Re-click to continue draining the queue.

## F. Model options (implemented — switch in Configure)
| Provider / model | Why consider | List rate (USD/1M, in/out) |
|---|---|---|
| **Groq `openai/gpt-oss-20b`** (default paid) | Very cheap, fast, JSON mode + low reasoning | 0.075 / 0.30 |
| Groq `openai/gpt-oss-120b` | Stronger reasoning, still cheap | 0.15 / 0.60 |
| Groq `llama-3.3-70b-versatile` | Open-model baseline | 0.59 / 0.79 |
| OpenAI `gpt-4o-mini` | Common cheap baseline | 0.15 / 0.60 |
| OpenAI `gpt-4o` | High-budget, strong | 2.50 / 10.00 |
| Anthropic `claude-haiku-5-5` | Cheap/fast, cached system prompt | 0.80 / 4.00 |
| Anthropic `claude-sonnet-4-5` / `claude-opus-4-1` | High-budget accuracy | 3 / 15 · 15 / 75 |
> Rates are published list estimates baked into `lib/pricing.ts` (provider-aware).
> **Do not trust them as contract rates** — read each provider's pricing page on
> measurement day, record the date in `07`, and override via
> `LLM_INPUT_PRICE_PER_M` / `LLM_OUTPUT_PRICE_PER_M` / `LLM_CACHE_READ_PRICE_PER_M`
> (USD per 1M). Groq has no cache-read discount (cache rate 0).

## G. Cost levers
1. **Rule tagging at ingest = ₹0 marginal cost** — the biggest lever; the LLM is optional.
2. Regex/gazetteer pre-filter before any LLM spend.
3. Short truncated inputs; batch posts/call; cache the static system prompt.
4. Skip re-tagging unchanged `done` rows.
5. Cheapest model that clears the accuracy bar (e.g. ≥ 90%).