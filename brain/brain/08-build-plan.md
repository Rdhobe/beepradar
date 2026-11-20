# 08 — Build plan (as-built checklist)

> **As-built.** The system is implemented in `frontend/` (Next.js + Supabase).
> Phases 0–3 are done; the cron/Python-worker automation phase was **dropped** in
> favor of manual `/admin` runs + a 6 h cooldown. Remaining work is the eval
> numbers, deploy, and the video.

## Phase 0 — Setup ✅
- [x] Next.js (TS, Tailwind, App Router) in `frontend/`; Supabase Postgres; schema pushed from `04` (`lib/db/schema.sql`)
- [x] DB access: postgres.js wire pooler (writes) + PostgREST (reads); 12 s query auto-cancel
- [x] Env wired (see `03`); admin auth via Supabase + `ADMIN_EMAILS`; encrypted secrets (`SOURCE_KEYS_SECRET`)
- [ ] Source keys obtained where needed (aggregators); public ATS boards need none

## Phase 1 — Ingest ✅
- [x] `normalize.ts`, `cities.ts`, `prefilter.ts`, `dedupe.ts` (+ Vitest)
- [x] TS adapters: Greenhouse / Lever / Ashby / SmartRecruiters / Workable / Workday / … + aggregators (Adzuna, Jooble, Careerjet, JSearch) + feeds (Remotive, Jobicy, Arbeitnow, HN, RSS, JSON-LD)
- [x] DB-backed registry (`source_admin`) + custom sources via `api.adapter`
- [x] `POST /api/admin/run` (single | selected | tick) with per-source try/catch + `ingest_runs` logging
- [x] Raw → filtered → unique counts per source in `/admin/stats`
- [ ] Keep running sources to reach **200+ unique** India fresher/intern posts

## Phase 2 — Tagging ✅
- [x] **Rule tagger at ingest** (`rule_tagger.ts`, `tag_model='rule-v1'`, `tag_status='done'`, ₹0)
- [x] Backfill `POST /api/admin/retag` (`ruleTagUntagged`) for previous data
- [x] Optional LLM pass `tagger.ts` (Zod, batch, repair retry, `llm_runs` logging) via `POST /api/admin/tag`
- [x] Tag analysis `GET /api/admin/tagging` (counts + recent runs + config); `/admin` Tagging card

## Phase 3 — UI + search ✅
- [x] `/api/jobs` (FTS + role/city/type filters + pagination), `/api/jobs/[id]`
- [x] Jobs board: search, filter chips, brutalist job cards, full-info modal, source badge, "Apply at source", "Last refreshed", count; anon gate
- [x] Mobile/desktop pass; empty/loading/error states; landing + login + footer
- [x] `/admin` (integrations, run/bulk/ready, live log, tagging) + `/admin/stats` (funnel, **INR pricing**, cost estimator)

## Phase 4 — Run model + cost ✅ (cron dropped)
- [x] **Manual runs** from `/admin`; ready queue = connected + quota left + off cooldown
- [x] **6 h cooldown** per source (`source_state.next_due_at`), enforced server + client
- [x] Quotas (`source_quota_usage`) + 429 backoff; chunked run budgets; pooler-safe DB
- [x] **INR pricing engine** (`lib/pricing.ts`, env-overridable rates + `USD_INR_RATE`), live estimator
- [x] No `vercel.json` crons, no GitHub Actions worker

## Phase 5 — Numbers ⏳
- [ ] Export 50-sample, hand-label (blind), run `eval/score.py`; compare rule vs LLM vs human
- [ ] Run the optional LLM pass on a sample to log real tokens; read ₹/1,000 from `/admin/stats`
- [ ] Fill result tables in `07` (record price-read date + model id)

## Phase 6 — Ship ⏳
- [ ] Deploy to Vercel; set env (`03`); confirm Supabase GRANT + RLS for REST reads
- [ ] README (setup, architecture, numbers, limitations), `.env.example`
- [ ] Record video from `09`; submit URL + repo + video

## Cut list (what was deliberately dropped)
Dropped: Python worker, GitHub Actions cron, Vercel Cron, LLM-first tagging queue,
Neon/Drizzle. Kept: TS adapters + dedupe + **rule tagging** + search + manual runs
+ cooldown + INR cost engine. Optional: LLM override, second-model comparison,
50-post eval (still required deliverables).