# 🧠 brain/ — Beep Gen AI & Engineering Assignment

> Read this file first. Every other file in this folder expands one part of it.
> If you are an AI coding agent (Claude Code / Cursor): treat this folder as the source of truth. Do not invent sources, endpoints or prices that are not listed here. Anything marked **VERIFY** must be checked live before being relied on.

## One-line goal
A live Next.js site that shows **200+ real fresher/intern job posts in India**, deduplicated, **tagged by role + city** (rule-tagged free at ingest; optional LLM override), searchable, **refreshed on demand from `/admin`** (no cron), plus a video, a repo, a **50-post hand-checked accuracy number** and a **cost per 1,000 posts in INR**.

> **As-built deltas from the original plan:** Supabase (not Neon) + postgres.js/PostgREST (not Drizzle); **no cron / no Python worker** — all sources are TS adapters, runs are manual from `/admin` with a **6 h per-source cooldown**; **rule-first tagging at ingest** (LLM optional); cost reported live in **₹** via `lib/pricing.ts` + `/admin/stats`. See `01` for the full delta table.

## The one routing rule (decides every implementation choice)
| If the source / task… | Build it in… |
|---|---|
| is open/public, callable with a plain HTTPS `fetch` (JSON API, RSS, public ATS board API), needs at most an API key | **Next.js** (route handler / lib adapter) |
| needs HTML parsing, a headless browser, anti-bot handling, or a long-running process | Originally a **Python worker**; **as-built every chosen source is plain-HTTPS fetchable, so all adapters are TS** and the worker is not used |
| is search, dedupe, tagging, UI, runs | **Next.js + Supabase Postgres** (always) |

As-built: everything is TypeScript in `frontend/`, landing in the same Postgres table through the same normalize → pre-filter → **rule-tag** → dedupe pipeline. Runs are **manual from `/admin`** (no cron); each source cools down 6 h after a run.

> Paid/official-feed addition (2026-11-20): SerpApi (Google/Indeed/Glassdoor Jobs), HireBase + LinkedIn Job Search on RapidAPI, Fantastic.jobs direct API, JobsPipe, CleanJobData and three configured Apify Actors (`parsebird/naukri-jobs-scraper`, `crawloop/internshala-scraper`, `crawloop/foundit-jobs-scraper`) were added via `frontend/lib/sources/licensed_apis.ts`. Feeds covering blocklisted sites are **link-back only** (`RawJob.licensedFeed`); BeepRadar never fetches those sites directly. See `02-sources.md` §5 and `sources_registry.json`.

## Index
| File | What's inside |
|---|---|
| `00-assignment.md` | Task, deliverables, definition of done |
| `01-architecture.md` | Diagram, components, why each choice |
| `02-sources.md` | Every public source: access, terms, where implemented, expected yield, **do-not-scrape list** |
| `sources.yaml` | Machine-readable source registry the code reads |
| `03-techstack.md` | Stack, versions, env vars, repo layout, free-tier limits |
| `04-data-model.md` | Postgres schema, role & city taxonomy |
| `05-pipeline.md` | Ingest → normalize → pre-filter → rule-tag → dedupe → serve; manual run model + 6 h cooldown |
| `06-llm-tagging.md` | Rule-first tagging (free) + optional LLM override; backfill; admin endpoints; how to run |
| `07-eval-and-cost.md` | 50-post accuracy protocol + live INR cost-per-1,000 engine |
| `08-build-plan.md` | Phased checklist |
| `09-video-script.md` | Walkthrough outline + "what broke" log template |
| `10-risks-compliance.md` | ToS, attribution, privacy, failure modes |

## Status tracker (as-built)
- [x] Source adapters built + registry (DB-backed `source_admin` patches/custom)
- [x] Ingest from multiple sources working (`ingest_runs` logged per source)
- [ ] 200+ unique India fresher/intern posts in DB (keep running sources; dedupe keeps it unique)
- [x] Dedupe verified (raw → passed → unique → dup_url/fp/fuzzy counts in `/admin/stats`)
- [x] Rule tagging at ingest (role/city/type/fresher, `rule-v1`, ₹0); backfill wired (jsonb `sql.json` fix); **title-priority accuracy fix** + admin **Re-apply rules** button
- [x] Multi-provider LLM pass (Groq `openai/gpt-oss-20b` default · OpenAI · Anthropic) + admin **Configure** (free/paid, provider, model, encrypted key → `tagging_config`); **Groq free-tier pacing** (30 RPM / 8K TPM / 1K RPD / 200K TPD) + 429 backoff
- [x] Search UI built + verified locally (FTS + filters, anon gate, job modal with **formatted HTML descriptions**: headings/bullets/paragraphs)
- [x] Manual refresh from `/admin` (run / bulk / ready queue) + **6 h cooldown** per source
- [x] INR cost engine live (`lib/pricing.ts` → `/api/stats` → `/admin/stats` + estimator)
- [ ] 50-post gold set labeled, accuracy computed (rule vs LLM vs human)
- [ ] Cost per 1,000 measured from real LLM runs (engine ready; spend ₹0 until the LLM pass runs)
- [ ] Deploy to Vercel + env set; video recorded; repo public with README

## Working rules
1. Respect every site's terms and robots.txt. Prefer official APIs. Link back to the source; never present scraped posts as your own.
2. Log everything that costs money (LLM tokens) and everything that breaks (it feeds the video).
3. Real data only. No synthetic/seed jobs in the production DB.
