# 02 — Sources (public / open / API-first)

Legend — **Impl**: `NEXT` = Next.js adapter, `PY` = Python worker. **Status**: ✅ confirmed during research · 🔎 VERIFY before relying on it (endpoint/terms/limits may have changed).
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

## Yield planning (fill in with real numbers after first run)
| Source | Raw fetched | After India+fresher filter | Unique after dedupe |
|---|---|---|---|
| Adzuna | | | |
| Jooble | | | |
| ATS boards (sum) | | | |
| JSearch | | | |
| Tier 2 | | | |
| **Total** | | | **≥ 200** |
