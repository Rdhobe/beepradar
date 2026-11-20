# 02 — Sources (public / open / API-first)

Legend — **Impl**: `NEXT` = Next.js adapter, `PY` = Python worker (planned). **As-built: every implemented source is a `NEXT` TS adapter in `frontend/lib/sources/`; the `PY` worker was not needed.** **Status**: ✅ confirmed during research · 🔎 VERIFY before relying on it (endpoint/terms/limits may have changed). The live registry is `sources_registry.json` merged with DB `source_admin` patches/custom sources; blocklisted sites are never fetched.
Target: ~600–1,000 raw → 200+ unique India fresher/intern posts after filtering + dedupe.

## Tier 1 — Primary (do these first; they alone should clear 200)

### 1. Adzuna India — `NEXT` ✅
- Official job-search API with an **India (`in`) market**; free developer account → `app_id` + `app_key`. https://developer.adzuna.com/
- Endpoint: `https://api.adzuna.com/v1/api/jobs/in/search/{page}?app_id=…&app_key=…&results_per_page=50&what=intern&where=bangalore&sort_by=date&max_days_old=14`
- Loop `what` ∈ {`intern`, `internship`, `fresher`, `graduate trainee`, `entry level`, `associate software engineer`} × `where` ∈ top ~12 cities × pages 1–3.
- Free tier has daily limits (third-party docs report ~250 calls/day) 🔎 — budget calls; cache.
- Gives aggregated listings with redirect links → **expect cross-source duplicates**.

### 2. Jooble — `NEXT` 🔎
- Free API key by request: https://jooble.org/api/about — `POST https://jooble.org/api/{key}` with JSON `{keywords, location, page}`.
- Third-party docs report a generous daily quota (~500/day) 🔎.
- Strong India coverage via many local boards.

### 3. Public ATS board APIs (company career pages) — `NEXT` ✅(Greenhouse) 🔎(others)
No key, official public JSON, direct-from-employer (highest data quality, lowest duplicate risk). Fetch all jobs → filter by India location + title keywords (`intern`, `graduate`, `trainee`, `associate`, `SDE`, `analyst`, `entry`).

| ATS | Endpoint | Notes |
|---|---|---|
| Greenhouse ✅ | `GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` | Read endpoints are public/no-auth; token = slug in `boards.greenhouse.io/{token}` |
| Lever 🔎 | `GET https://api.lever.co/v0/postings/{company}?mode=json` | `location`, `categories`, `hostedUrl` |
| Ashby 🔎 | `GET https://api.ashbyhq.com/posting-api/job-board/{name}` | JSON board |
| SmartRecruiters 🔎 | `GET https://api.smartrecruiters.com/v1/companies/{id}/postings?country=in` | Paginated |
| Workable 🔎 | `GET https://apply.workable.com/api/v1/widget/accounts/{subdomain}` | Widget JSON |

**Finding India-relevant tokens:** don't guess one by one — run `scripts/probe_boards.ts` that tries each slug on each ATS and keeps those returning 200 with ≥1 India job. Candidate company names to probe (slugs vary; probe variants like `razorpay`, `razorpaysoftware`):
Razorpay, Groww, CRED, Meesho, PhonePe, Swiggy, Zomato, Flipkart, Postman, Freshworks, Zerodha, Dream11, ShareChat, Urban Company, Zepto, Slice, Jupiter, Juspay, BrowserStack, Chargebee, Hasura, Mindtickle, Sprinklr, Druva, Zeta, InMobi, Rapido, Licious, Lenskart, Nykaa, PharmEasy, upGrad, Unacademy, Physics Wallah, Spinny, CarDekho, Navi, Cashfree, Pine Labs, MoEngage, CleverTap, Gupshup, Atlan, Uber, Atlassian, Rippling, Databricks, Stripe, Cloudflare, Airbnb, Figma (global companies with India offices).

### 4. JSearch (RapidAPI) — `NEXT` 🔎
- Aggregates Google-for-Jobs results via a licensed API; limited free tier. Good **gap-filler** if Tier 1 is short. Query e.g. `fresher developer jobs in Pune, India`.
- Also used for **internships** (`internship in <city> India` queries); the separate Fantastic.jobs "Internships API" is no longer available on RapidAPI.

### 5. Additional licensed job-data APIs (added 2026-11-20) — `NEXT`
All keys go through `RAPIDAPI_KEY` / `SERPAPI_KEY` / `JOBSPIPE_API_KEY` (env or `/admin` vault). Adapters live in `frontend/lib/sources/licensed_apis.ts`; registry entries in `sources_registry.json`.

| Source | Verified access | Quota / budget | Notes |
|---|---|---|---|
| SerpApi Google Jobs | `GET https://serpapi.com/search?engine=google_jobs&q=…&location=…&gl=in&hl=en&api_key=…` → `jobs_results[]` (`title`, `company_name`, `location`, `description`, `share_link`, `apply_options[].link`, `detected_extensions.posted_at`) | 250 searches/month total across engines; 100 reserved here | `share_link` is a Google link-back URL, preferred when apply options point at blocked sites. |
| SerpApi Indeed Jobs | same endpoint, `engine=indeed_jobs`, location param is `l` (not `location`), `sort_by=date` | 50 of 250/month | `jobs_results[]` includes `link`, `days_since_posted`, `description`. Licensed feed only — never request indeed.com directly. |
| SerpApi Glassdoor Jobs | same endpoint, `engine=glassdoor_jobs`, `location=…` | 50 of 250/month | `jobs_results[]` includes `job_id`, `title`, `company_name`, `location`, `link`, `days_since_posted`. Licensed feed only. |
| HireBase Jobs Data (RapidAPI) | `POST https://hirebase-jobs-data.p.rapidapi.com/v2/jobs/search` with `X-RapidAPI-Key` / `X-RapidAPI-Host`; body `{ job_titles:[…], keywords:[…], geo_locations:[{country:"India"}], page, limit }` | 500 jobs/month, billed per job returned; adapter caps pages at 25 jobs and 15 calls/month | Employer career-page/ATS data (not job boards). Unknown body fields return 422; use `job_titles` and `geo_locations`. VERIFY host in playground on first run. |
| LinkedIn Job Search API (Fantastic.jobs, RapidAPI) | `GET https://linkedin-job-search-api.p.rapidapi.com/active-jb?time_frame=24h&limit=100&title=…&location=India` | RapidAPI free-plan gateway 1000 req/hour; monthly Jobs credits are plan-specific — VERIFY in dashboard | Vendor recommends `/active-jb` + `24h` for recurring sync. URLs are link-back only (`licensedFeed=true`); no direct LinkedIn traffic. |
| Fantastic.jobs direct API | `GET https://data.fantastic.jobs/v1/active-ats` and `/v1/active-jb` with `Authorization: Bearer FANTASTIC_JOBS_API_KEY`; `time_frame=7d`, `limit=10`, `description_format=text`, `location=India`, `ai_experience_level=0-2`, rotating `title` | 14-day trial: 100 requests + 500 included jobs; self-imposed 3 req/day × 10 jobs = 420 jobs / 42 requests over 14 days | Official direct key from `dashboard.fantastic.jobs` (separate from `RAPIDAPI_KEY`). Bare JSON array. ATS fields: `id`, `organization`, `locations_derived[]`, `description_text`, `date_posted`; job-board rows add `seniority`, `exclude_recruiter_fields`. LinkedIn-job URLs are link-back only (`licensedFeed=true`). VERIFY how included jobs are counted on first run. |
| JobsPipe | `POST https://api.jobspipe.dev/v1/jobs/search`, Bearer token; body `job_title_or`, `job_country_code_or:["IN"]`, `posted_at_max_age_days`, `limit:25` → `{ metadata, data[] }` | Self-imposed 1 req/day until free credits are confirmed | Aggregates 30+ public ATS boards. OpenAPI spec: `https://jobspipe.dev/openapi.json`. 402 = quota, 429 = rate limit. |
| CleanJobData | `GET https://api.cleanjobdata.com/jobs` with `Authorization: Bearer CLEANJOBDATA_API_KEY`; `location=IN`, `max_age=30d`, `extra_fields=description`, `limit=20`, cursor via `pagination.next_page` → `{ data[], pagination, meta }` | User account: 300 requests/day on a 14-day trial; self-imposed 8 req/day (4 India fresher/intern variants × 2 pages) | Official partner API over ATS/company-career-site data; ~57K India jobs reported. Trial `application_url` is a `cleanjobdata.com/apply/{id}` redirect. VERIFY: dashboard plan/limits and whether the trial converts to paid or stops. |
| Apify — Naukri | `POST https://api.apify.com/v2/actors/parsebird/naukri-jobs-scraper/run-sync-get-dataset-items?timeout=300`, JSON body = Actor INPUT, Bearer `APIFY_TOKEN` | 1 run/day, 10/month; $1/1,000 standard results (`fetchDetails=false`), $3/1,000 detailed | Verified Actor ID and input schema. Rotates `keyword` over `fresher / internship / graduate trainee / entry level`; `experience="0"`, `freshness="30"`, `maxJobs=100`. Output mapped from `jobId`, `jdURL`, `companyName`, `createdDate`. |
| Apify — Internshala | `POST https://api.apify.com/v2/actors/crawloop/internshala-scraper/run-sync-get-dataset-items?timeout=300`, JSON body = Actor INPUT, Bearer `APIFY_TOKEN` | 1 run/day, 10/month; from $0.89/1,000 listings | Verified Actor ID and input schema. `listingType="internships_and_jobs"`, six-city `location`, daily rotating `position`, `monitorMode=true`. Output mapped from `listingId`, `url`, `employer`, `postedText`. |
| Apify — Foundit | `POST https://api.apify.com/v2/actors/crawloop/foundit-jobs-scraper/run-sync-get-dataset-items?timeout=300`, JSON body = Actor INPUT, Bearer `APIFY_TOKEN` | 1 run/day, 10/month; from $0.89/1,000 listings | Verified Actor ID and input schema. `experienceMinYears=0`, `experienceMaxYears=2`, `postedWithinDays="30"`, daily rotating `position`, `monitorMode=true`. Prefers `applyUrl` over the Foundit detail URL. |

## Tier 2 — Supplementary

| Source | Access | Impl | Notes |
|---|---|---|---|
| Remotive 🔎 | `GET https://remotive.com/api/remote-jobs?category=software-dev` | NEXT | Remote; **requires attribution/backlink and conservative polling** (check API terms). Filter to India-eligible. |
| Himalayas 🔎 | `https://himalayas.app/jobs/api` | NEXT | Remote jobs; filter by country eligibility. |
| Jobicy 🔎 | `https://jobicy.com/api/v2/remote-jobs?geo=india` | NEXT | Remote, geo filter. |
| Arbeitnow 🔎 | `https://www.arbeitnow.com/api/job-board-api` | NEXT | Mostly Europe; low India yield — optional. |
| Hacker News "Who is hiring" ✅ | Algolia: `https://hn.algolia.com/api/v1/search?query=who%20is%20hiring&tags=story,author_whoishiring` then Firebase `https://hacker-news.firebaseio.com/v0/item/{id}.json` | NEXT | Free, no key. Few India fresher roles; useful for startups + a LLM-extraction showcase (free-text posts). |
| Reddit r/developersIndia, r/internshipsindia 🔎 | Subreddit `.rss` | PY (or NEXT) | **Check Reddit's API/content terms before use.** Free-text → LLM extracts job fields. Keep volume low, always link back. |

## Tier 3 — Python-worker sources (only if still short of 200)

| Source | Method | Notes |
|---|---|---|
| Company career pages with schema.org `JobPosting` JSON-LD 🔎 | `httpx` + `extruct` | Many Indian company/startup sites embed JSON-LD. Check each site's robots.txt/terms. Respect crawl delay. |
| Government portals: AICTE internship portal, Apprenticeship India, National Career Service (NCS) 🔎 | HTML/API inspection | Public-interest portals; read terms + robots.txt first. Strong fresher relevance. |
| Public RSS feeds from job blogs/boards 🔎 | `feedparser` | Only feeds explicitly published for syndication. |
| Curated public GitHub lists of Indian off-campus drives/internships 🔎 | GitHub REST (`api.github.com`) via NEXT or raw files via PY | Verify each repo's license; link back. |
| Common Crawl / WebDataCommons `JobPosting` extracts 🔎 | Bulk files | **Stale** — use only for dev-time test data, not production. |

## ⛔ Do NOT scrape (terms prohibit automated access) — mention this in the video
LinkedIn, Naukri, Indeed, Internshala, Glassdoor, Foundit/Monster, Instahyre, Wellfound/AngelList (no public API), Shine, TimesJobs. Third-party tools like JobSpy scrape LinkedIn/Indeed — **do not use them** for this assignment. If one of these is ever needed, use only an officially licensed API/partner feed. 🔎 re-check each site's terms yourself; the safe default is "don't".

**Decision 2026-11-20 (user-approved exception):** paid/official data feeds for LinkedIn (RapidAPI and Fantastic.jobs direct), Indeed and Glassdoor (SerpApi), CleanJobData, and the three configured Apify Actors (Naukri / Internshala / Foundit) are enabled **as data feeds only**. BeepRadar never issues a request to those sites; their URLs are stored for attribution/link-back with `RawJob.licensedFeed=true` and the UI must label the provider. Direct scraping of these sites (e.g. JobSpy) and any actor ID not listed in `sources_registry.json` remain forbidden. Confirm each Actor's terms in the Apify dashboard before production use.

## Yield planning (fill in with real numbers after first run)
| Source | Raw fetched | After India+fresher filter | Unique after dedupe |
|---|---|---|---|
| Adzuna | | | |
| Jooble | | | |
| ATS boards (sum) | | | |
| JSearch | | | |
| SerpApi (3 engines) | | | |
| HireBase / JobsPipe / LinkedIn RapidAPI / Fantastic.jobs direct / CleanJobData | | | |
| Apify actors (3) | | | |
| Tier 2 | | | |
| **Total** | | | **≥ 200** |
