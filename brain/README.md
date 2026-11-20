# 🧠 brain/ — Beep Gen AI & Engineering Assignment

> Read this file first. Every other file in this folder expands one part of it.
> If you are an AI coding agent (Claude Code / Cursor): treat this folder as the source of truth. Do not invent sources, endpoints or prices that are not listed here. Anything marked **VERIFY** must be checked live before being relied on.

## One-line goal
A live Next.js site that shows **200+ real fresher/intern job posts in India**, deduplicated, **LLM-tagged by role + city**, searchable, **auto-refreshed daily**, plus a video, a repo, a **50-post hand-checked accuracy number** and a **cost per 1,000 posts**.

## The one routing rule (decides every implementation choice)
| If the source / task… | Build it in… |
|---|---|
| is open/public, callable with a plain HTTPS `fetch` (JSON API, RSS, public ATS board API), needs at most an API key | **Next.js** (route handler / lib adapter) |
| needs HTML parsing, a headless browser, anti-bot handling, heavy text processing, or a long-running process | **Python worker** (separate, scheduled by GitHub Actions; pushes normalized rows to Next.js `/api/ingest/external`) |
| is search, dedupe, LLM tagging, UI, cron | **Next.js + Postgres** (always) |

Python is the exception, not the default. Everything lands in the same Postgres table through the same normalize → dedupe → tag pipeline.

## Index
| File | What's inside |
|---|---|
| `00-assignment.md` | Task, deliverables, definition of done |
| `01-architecture.md` | Diagram, components, why each choice |
| `02-sources.md` | Every public source: access, terms, where implemented, expected yield, **do-not-scrape list** |
| `sources.yaml` | Machine-readable source registry the code reads |
| `03-techstack.md` | Stack, versions, env vars, repo layout, free-tier limits |
| `04-data-model.md` | Postgres schema, role & city taxonomy |
| `05-pipeline.md` | Ingest → normalize → dedupe → tag → serve, cron design |
| `06-llm-tagging.md` | Prompt, JSON schema, model options, cost levers |
| `07-eval-and-cost.md` | 50-post accuracy protocol + cost per 1,000 posts method |
| `08-build-plan.md` | Phased checklist |
| `09-video-script.md` | Walkthrough outline + "what broke" log template |
| `10-risks-compliance.md` | ToS, attribution, privacy, failure modes |

## Status tracker (tick as you go)
- [ ] Sources verified live (keys obtained)
- [ ] Ingest from ≥ 4 sources working
- [ ] 200+ unique India fresher/intern posts in DB
- [ ] Dedupe verified (report raw → unique counts)
- [ ] LLM tagging running with schema validation
- [ ] Search UI deployed
- [ ] Daily cron proven (two consecutive automatic runs)
- [ ] 50-post gold set labeled, accuracy computed
- [ ] Cost per 1,000 posts measured from logged tokens
- [ ] Video recorded, repo public with README

## Working rules
1. Respect every site's terms and robots.txt. Prefer official APIs. Link back to the source; never present scraped posts as your own.
2. Log everything that costs money (LLM tokens) and everything that breaks (it feeds the video).
3. Real data only. No synthetic/seed jobs in the production DB.
