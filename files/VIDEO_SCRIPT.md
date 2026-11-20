# BeepRadar — professional demo recording script

**Length:** 10–12 minutes · **Audience:** recruiters, founders, open-source reviewers, potential users
**Style:** calm, fast-cut, no key strokes hidden — narrate what you click.
**Golden rule:** never show a real API key on screen. Use the masked values from `/admin → Keys vault` only.

> Keep `/admin/flow` open in a second tab. It is the "Flow →" button next to "Stats →" in the Control room. Use it for the chapter cards if you need a clean reset between takes.

---

## 0. Before you press record (5-minute setup)

1. Deploy to Vercel first, or run locally with `npm run dev`. Recording an unfinished local build looks worse than a clean production URL.
2. Confirm these in **Vercel → Project → Settings → Environment Variables**:
   - `DATABASE_URL` — use the Supabase **transaction pooler** string (port `6543`). The code forces SSL and disables prepared statements for this exact setup.
   - `ADMIN_EMAILS` — comma-separated; your login email must be in it or `/admin` shows "not an admin".
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — browser auth.
   - `SOURCE_KEYS_SECRET` — 64 hex chars (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). Needed to save keys in the vault.
   - `CAREERJET_API_KEY`, `RAPIDAPI_KEY`, `HIMALAYAS_API_KEY`, `SERPAPI_KEY`, `JOBSPIPE_API_KEY`, `APIFY_TOKEN`, `GROQ_API_KEY` — your configured feeds + tagging.
   - `USER_AGENT` — replace the placeholders: `BeepRadarBot/1.0 (+https://YOUR-DOMAIN; contact: YOUR-EMAIL)`.
3. Sign in once in the browser profile you will record with. Clear the URL bar from autofill suggestions.
4. In `/admin`, click **Run due sources →** once so the live log and Stats have real data. If everything is cooling down, that is fine — say so on camera, it proves the cooldown works.
5. Browser zoom 110–125%, 1440×900 or 1920×1080, hide bookmarks bar and notifications.

---

## 1. Cold open — the promise (0:00–0:35)

**Screen:** `/` at the top, slow scroll, no cursor movement for the first 3 seconds.

**Say:**
> "Every fresher job in India is scattered across forty portals and career pages. BeepRadar watches them, removes the duplicates, tags each opening by role and city, and gives you one place to search. This is the product, the pipeline, and the admin controls behind it — end to end."

**Cut to:** the three big numbers. Point at them.

> "Live counts come from the database, not a hardcoded marketing number. Every card here is a real posting with a link back to the original employer."

**Scroll** to *Why BeepRadar* and *How it works*. Do not read every card aloud; say:

> "Real sources only, three-layer dedupe, tags, and a quota-aware daily refresh. Those four claims are about to become visible in the admin panel."

---

## 2. Sign in — trust boundary (0:35–1:10)

**Click:** `Sign in`.

**Say:**
> "Sign in is Supabase email and password. This matters because the job board gives anonymous visitors a preview — six jobs — and signed-in users get the full board, all filters, and direct apply links."

**Demo:** type email/password (use a demo account you are happy to show), submit. Land on `/jobs`.

**Say:**
> "Admin access is a separate gate: the email must also be listed in `ADMIN_EMAILS`. Being logged in does not make you an admin."

---

## 3. The job board — user value (1:10–2:30)

**Screen:** `/jobs` signed in.

**Say:**
> "This is everything a student actually touches. Search is full-text over title, company and skills. Filters are role, city and job type — all derived from the tagging step, not typed by hand."

**Demo slowly, one at a time:**
1. Type `react intern` in the search box. Wait for the 300 ms debounce.
2. Choose a role from the dropdown.
3. Choose a city.
4. Choose `internship` type.

**Say after each:**
> "Watch the result count change. It is a server-side query with pagination, not a client-side filter over a downloaded list — so it stays fast as the database grows."

**Clear all filters** (if you hit the empty state, good — show the `Clear all filters` button).

**Click a job card** → modal opens.

**Say:**
> "The card is the scan view; the modal is the decision view — full description, tags, source and posted date. `Apply at source ↗` is deliberately a link back to the employer. We do not host the application, and we never rewrite the job."

**Close modal.** Mention:
> "Anonymous users see the same cards but no search, no filters and a 'Sign in to apply' button. That is intentional preview-mode behavior."

---

## 4. Flow page — the map (2:30–3:40)

**Navigate:** `/admin` → click the blue **Flow →** button beside **Stats →**.

**Say:**
> "This page is the map I use when onboarding or debugging. It is the same system you just used as a user, from the other side."

**Scroll top to bottom. Narrate each section in one sentence:**
1. **30-second version:** "Collect, filter, dedupe, tag, serve. You drive collection from the Control room; Stats proves what happened."
2. **Pipeline cards:** "45 enabled sources, each with its own cron, quota and six-hour cooldown. India and fresher heuristics reject junk before storage. Three dedupe layers collapse cross-postings. Rules tag free at ingest; an optional Groq pass improves labels."
3. **Page map:** "Six routes total. Public: home, login, jobs. Admin: control room, stats, and this page."
4. **Control room blocks:** "Five blocks — run ingestion, integrations, encrypted key vault, advanced source table, tagging."
5. **Non-negotiable rules:** "Real data only. Blocklisted portals are never fetched; licensed feeds are link-back-only. Quotas are checked before every request with a safety margin. 429s trigger backoff. Posts unseen for 14 days retire."
6. **Deployment checklist:** "These are the Vercel env vars. Note the two newest sources — CleanJobData and direct Fantastic.jobs — are optional trial feeds; add their keys when you are ready."

**Say as a bridge:**
> "So much for the map. Let me show each of those admin blocks live."

---

## 5. Control room — run ingestion (3:40–5:20)

**Click `← Control room`.**

**Say:**
> "The Control room is the ignition. There is no background cron in this deployment, so every ingestion is an explicit, auditable action."

**Point at the header chips:** available / connected / need keys / off.

> "Integration states come from resolved keys — env vars or the encrypted vault. A source without a key is skipped automatically; it is never silently faked."

**Point at `Run due sources →`:**

> "This is the safe button. It runs only connected sources that have quota left and are off cooldown, in priority order — never all at once, never forty parallel requests."

**Click it.** Let the live log stream. **Say while it runs:**
> "The live log is per source: fetched, passed filter, inserted, duplicates by type. If a source returns 429, it goes into backoff and its daily budget is halved until a clean run. You can watch that here instead of guessing."

**If the ready queue is empty, say:**
> "Nothing ready right now — everything connected is cooling down or quota-spent. That is the system working, not a bug. The queue refills on its own."

**Optional 20-second insert:** choose one source card in the ready queue and press its individual **Run** button. Show that only that source moves.

---

## 6. Integrations + vault (5:20–6:30)

**Scroll to `02 // Integrations`.**

**Say:**
> "Every keyed source is visible here with its state and required key names. You can paste a key once into the vault, or keep it in Vercel env; the vault wins if both exist."

**Click `+ Add integration`** — show the form shape (adapter, base URL, cron, quotas, field map), then **cancel**. Do not save a test source.

> "Custom sources use the same quota engine as built-ins. `Test fetch` validates the mapping before you enable anything."

**Scroll to `03 // Keys vault`.**

> "Keys here are AES-256-GCM encrypted with `SOURCE_KEYS_SECRET`. Values are masked. Never paste a real key into chat, a ticket, or a screenshot — including this video."

**Important:** show only masked rows. If a real value is visible, blur it in post.

---

## 7. Advanced table + tagging (6:30–7:20)

**Scroll to `04 // Advanced table`.** Toggle it briefly.

> "This is the raw registry: adapter, method, cron, daily and monthly budgets, quota windows, and response field mapping. It is the same JSON the runner reads — no hidden config."

**Scroll to `05 // Tagging`.**

> "Tagging is rule-first and free at ingest. Switch to LLM mode only if you want the optional quality pass. `GROQ_API_KEY` is the provider configured here — default model `openai/gpt-oss-20b`. Cost is measured in Stats, so there is no surprise bill."

**Do not actually flip the mode to LLM during the recording** unless you intend to spend tokens.

---

## 8. Stats — proof (7:20–8:40)

**Click `Stats →`.**

**Say:**
> "Stats is the proof that the pipeline did what the Flow page claims."

**Narrate in order:**
1. **Four top tiles:** "Raw fetched, passed filter, unique inserted, duplicates dropped — the funnel in four numbers."
2. **Ingest funnel by source:** "This is where you see which API is carrying volume and which one is wasting requests. Dup URL, fingerprint and fuzzy columns show exactly which dedupe layer fired."
3. **Pricing & unit cost:** "Rule tagging is zero. LLM spend is tracked per 1,000 posts, with the provider, model and token counts visible. If there is no LLM spend yet, that is the default state."
4. **Source schedule & state:** "Enabled count, next due time, remaining quota, backoff state. This is the scheduler's view of the same cooldown the Control room showed."

**Say:**
> "Together, Control room and Stats turn ingestion from a black box into an auditable pipeline."

---

## 9. Deployment close — Vercel + env (8:40–10:00)

**Return to `/admin/flow`, scroll to `05 // Deployment checklist`.**

**Say slowly — this is the part deployers will rewind:**
> "On Vercel, set these under Project Settings → Environment Variables and redeploy. `DATABASE_URL` should be the Supabase transaction pooler URL — port 6543 — because the app forces SSL and disables prepared statements. `ADMIN_EMAILS` controls who can see the Control room. `SOURCE_KEYS_SECRET` must be 64 hex characters if you want the encrypted vault."

**Point at the groups:**
> "Working feeds today: CareerJet, RapidAPI, Himalayas, SerpApi, JobsPipe and Apify. Tagging uses Groq. CleanJobData and the direct Fantastic.jobs API are optional trial sources — add their keys when you are ready; they are capped low to protect the trial."

**Explain `USER_AGENT` on camera (one clean take):**
> "Finally, `USER_AGENT` is the identity we present when we request a public page. It is a courtesy string: bot name, a URL where the site owner can learn about us, and a contact email. Replace `YOUR-DOMAIN` with your deployed URL and `YOUR-EMAIL` with a real inbox. Leave the placeholders and you are telling every site you do not want to be contacted — which is exactly how polite bots get blocked."

**End on the public board:**

> "BeepRadar: real jobs, one radar, and an admin panel that never hides what it did. Start searching at the link below."

Hold 3 seconds. Fade.

---

## 10. Suggested chapter markers (paste into YouTube description)

```
0:00  The problem
0:35  Sign in & the trust boundary
1:10  The job board: search, filters, apply
2:30  Flow page: the whole system on one screen
3:40  Control room: running ingestion safely
5:20  Integrations & encrypted key vault
6:30  Source registry & tagging
7:20  Stats: proving the pipeline
8:40  Deploying on Vercel + USER_AGENT explained
```

**Thumbnail text:** `ONE RADAR. 45 SOURCES. ZERO FAKE JOBS.`

---

## 11. Mistakes to avoid while recording

- Don't type a real key on camera — not even "just for a second."
- Don't claim a feed is live if its key is missing; say "needs connection."
- Don't call the LLM "AI that reads resumes" — it only labels role and city.
- Don't say there is a Vercel cron. There isn't: runs are manual from `/admin`.
- Don't show an empty Stats page as if it were data; if it is empty, say the first run has not happened yet.
- Don't scroll fast through the Flow page — it is the chapter spine of the video.

---

## 12. Env audit for your exact list

| You configured | Status | Note |
|---|---|---|
| `DATABASE_URL` | required | Use Supabase pooler `postgresql://...@aws-0-<region>.pooler.supabase.com:6543/postgres`. |
| `ADMIN_EMAILS` | required | Your login email must be listed. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | required | Client auth + REST reads. |
| `SOURCE_KEYS_SECRET` | required for vault | 64 hex chars. Env-only keys work without it, but the admin vault will show "master key missing". |
| `CAREERJET_API_KEY`, `RAPIDAPI_KEY`, `HIMALAYAS_API_KEY`, `SERPAPI_KEY`, `JOBSPIPE_API_KEY`, `APIFY_TOKEN` | active sources | Good — these map to real adapters. |
| `GROQ_API_KEY` | correct | The app's LLM provider list uses Groq; no Anthropic key is needed. |
| `USER_AGENT` | fix before deploy | Replace `YOUR-DOMAIN` and `YOUR-EMAIL` with real values. |
| `CLEANJOBDATA_API_KEY` | optional | Needed only for `cleanjobdata_in`; currently `pending_key`. |
| `FANTASTIC_JOBS_API_KEY` | optional | Needed only for `fantastic_jobs_in` (direct dashboard key); currently `pending_key`. Distinct from `RAPIDAPI_KEY`. |
| `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` / `JOOBLE_API_KEY` | optional | Adapters exist; sources stay off without keys. Adding them increases real-job volume. |
| `LLM_PROVIDER` / `LLM_MODEL` | optional | Defaults to Groq / `openai/gpt-oss-20b`. Only set to override. |
| `CRON_SECRET` / `INGEST_SECRET` | not needed | No Vercel cron is configured. |

**Bottom line:** your list is deployable as-is once `USER_AGENT` placeholders are replaced. The two trial feeds stay `pending_key` until you add their keys — that is deliberate, not a missing step.
