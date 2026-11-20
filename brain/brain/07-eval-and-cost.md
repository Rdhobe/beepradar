# 07 — Accuracy (50 posts) & cost per 1,000 posts

## A. Accuracy protocol
1. **Sample** 50 tagged posts with a fixed seed, stratified: ≥ 5 per top role, spread across ≥ 6 cities, include ~10 "hard" ones (multi-city, vague title, remote, free-text source). Script: `scripts/export_eval_sample.ts` → `eval/gold_50.csv` with columns:
   `id,title,company,location_raw,description_snippet,url,llm_role,llm_city,llm_job_type,human_role,human_city,human_job_type,notes`
   (Hide `llm_*` columns while labeling — blind label first, then reveal.)
2. **Label by hand** using the exact taxonomy in `04`. Where genuinely ambiguous, record `notes` and pick the best single answer (don't change the label to match the LLM).
3. **Score** (`eval/score.py`):
```python
import pandas as pd, numpy as np
from math import sqrt
df = pd.read_csv("eval/gold_50.csv")
def wilson(k, n, z=1.96):
    p = k/n; d = 1+z*z/n
    c = (p + z*z/(2*n))/d; h = z*sqrt(p*(1-p)/n + z*z/(4*n*n))/d
    return c-h, c+h
for col in ["role","city","job_type"]:
    ok = (df[f"llm_{col}"] == df[f"human_{col}"])
    lo, hi = wilson(ok.sum(), len(df))
    print(f"{col}: {ok.mean():.1%}  (95% CI {lo:.0%}–{hi:.0%})")
joint = ((df.llm_role==df.human_role)&(df.llm_city==df.human_city))
print(f"role+city both right: {joint.mean():.1%}")
print(pd.crosstab(df.human_role, df.llm_role))          # confusion matrix
print(df[~joint][["title","human_role","llm_role","human_city","llm_city","notes"]])  # error analysis
```
4. **Report** (put this table in the README and the video):
| Metric | Result |
|---|---|
| Role accuracy | x/50 |
| City accuracy | x/50 |
| Role + city both correct | x/50 |
| 95% CI (Wilson) | n=50 is small — say so |
| Top confusions | e.g. data_analytics ↔ marketing |
| Error causes | ambiguous title / multi-city / description missing / label-set gap |
| City: LLM vs gazetteer agreement | % |
| Accuracy by confidence bucket | shows whether `confidence` is usable for flagging |

Honesty note: with n=50 one error ≈ 2 points; give the CI and don't over-claim.

> The gold set can compare **rule tags vs LLM tags vs human** — rule tagging is the
> free default, so "how much accuracy does the optional LLM buy per ₹1,000?" is the
> story. Reset a sample to `pending` and run the LLM pass to get `llm_*` columns.

## B. Cost per 1,000 posts — as-built engine (INR)

> **As-built change.** Cost is computed live, not estimated by hand. The pipeline
> rule-tags at ingest for **₹0**; fetching public ATS boards is **free**. The only
> variable cost is the **optional LLM tagger**. All money is shown in **Indian
> rupees (₹)**; the provider bills USD, converted at a configurable FX rate.

### Code
- **`lib/pricing.ts`** — pure pricing helpers:
  - `resolvePrice(model, provider?)` → `{label, input_per_m, output_per_m, cache_read_per_m, source}`.
    Rate precedence: **env override → provider/model table → default**. `source` is
    `env | table | default`. With a `provider` it uses that provider's list table
    (Groq gpt-oss-20b 0.075/0.30/0, gpt-oss-120b 0.15/0.60/0, Llama-3.3-70B
    0.59/0.79/0; OpenAI gpt-4o-mini 0.15/0.60/0.075, gpt-4.1-mini 0.40/1.60/0.10,
    gpt-4o 2.5/10/1.25; Anthropic Opus 15/75/1.5, Sonnet 3/15/0.3, Haiku
    0.8/4/0.08). The legacy single-arg call keeps the Anthropic family fallback;
    unknown model → Haiku-class estimate. `/api/stats` passes the **configured**
    provider/model from `resolveTaggingConfig()`.
  - `llmCostUsd(tokens, price)` → `{input, output, cache, total}` (USD).
  - `costPer1000(totalUsd, posts)` → `totalUsd / posts * 1000`.
  - `inrRate()` → env `USD_INR_RATE` if finite & > 0, else `DEFAULT_USD_INR = 84`.
  - `round(n, dp=4)`.
- **`GET /api/stats`** (public, no auth) returns a `pricing` object that is
  **INR-primary** and keeps USD source rates for transparency:
  `model, price_label, price_source, inr_rate, input_per_m / output_per_m /
  cache_read_per_m` (₹ per 1M), `input_per_m_usd / output_per_m_usd`,
  `input_cost / output_cost / cache_cost / llm_cost` (₹, actual spend to date),
  `total_tagged_posts, rule_tagged_posts, llm_tagged_posts`,
  `cost_per_1000_llm, cost_per_1000_blended, rule_cost_per_1000 (=0)`,
  `tokens_per_post {input, output}`.
- **`/admin/stats`** (anon-viewable) renders section **02 // Pricing & unit cost**:
  hero cards (blended actual ₹/1,000, rule ₹0.00, LLM ₹/1,000, total spend), a
  rate strip (`IN ₹…/M · OUT ₹…/M · CACHE ₹…/M`, `FX ₹84/$`), a USD transparency
  note, token totals, and a live **Cost Estimator** (tagger toggle, volume
  slider + 1K/10K/100K/1M presets, input/output tokens-per-post sliders,
  projected ₹/1,000 + total + per-post, and a projection table). `en-IN`
  formatting gives Indian digit grouping (e.g. ₹1,00,800.00).

### Rule vs LLM split (don't dilute the rate)
`tagged` = all `tag_status='done'`. `rule_tagged` = those with `tag_model='rule-v1'`.
`llm_tagged = max(0, tagged − rule_tagged)`. The LLM ₹/1,000 uses **llm_tagged** as
the denominator so free rule tags don't artificially lower the LLM unit cost; the
**blended** ₹/1,000 uses all tagged posts. Rule cost is always ₹0.

### Formula (as implemented)
```
spend_usd   = input_tokens/1e6 × price_in
            + output_tokens/1e6 × price_out
            + cached_tokens/1e6 × price_cache_read
llm_cost_inr        = spend_usd × inr_rate
cost_per_1000_llm   = spend_usd / llm_tagged_posts  × 1000 × inr_rate
cost_per_1000_blend = spend_usd / total_tagged_posts × 1000 × inr_rate
```
Token totals come from `llm_runs` (every call logged, incl. failures/retries).
With no LLM runs yet, actual spend is ₹0 and the estimator projects from
tokens-per-post (default 900 in / 120 out → ₹100.80 per 1,000 at Haiku list × 84).

### Env overrides (USD per 1M tokens; FX separate)
```
LLM_INPUT_PRICE_PER_M=        # override input rate (USD/1M)
LLM_OUTPUT_PRICE_PER_M=       # override output rate (USD/1M)
LLM_CACHE_READ_PRICE_PER_M=   # override cache-read rate (USD/1M)
USD_INR_RATE=84               # FX; default 84 if unset/invalid
```
Read each provider's current pricing page on measurement day, set these, and
record the **date** + **model id**. The estimator's projection table is the
"what it would cost at 1M posts" extrapolation, clearly labeled as a projection.

### Full-system cost
Hosting $0 (Vercel Hobby) *if true on the day*; Supabase free tier for ~thousands
of rows; public ATS board fetches $0; rule tagging $0. State the **cost per
*unique* post** after dedupe & pre-filter (raw ≠ tagged ≠ unique).

### Measure, don't estimate
Every LLM call writes a `llm_runs` row (input/output/cached tokens, retries,
latency, ok). The `/admin/stats` panel and `/api/stats` read those totals directly
— the ₹/1,000 number is computed from real logged tokens, not a guess.