# 00 — Assignment (verbatim intent)

**Company:** Beep — career platform for college students in India (1M+ users, Shark Tank India). Role: Gen AI & Engineering.
**Context:** 3,500+ applicants; this is the shortlist round. "A real piece of work, not another form." They use AI for almost everything — using AI coding tools is expected.

## Task
1. **Build it** — a live web tool that:
   - collects **200+ real** fresher job / internship posts in **India** from public sources (respecting each site's terms)
   - **removes duplicates**
   - uses an **LLM to tag each post by role and city**
   - shows them on a **searchable page**
   - **refreshes every day on its own**
2. **Explain it** — video: architecture, **what broke and how you fixed it**. Share the repo.
3. **Put a number on it** — hand-check **50 posts**: tagging accuracy, and **cost per 1,000 posts**.

## Definition of done
| Deliverable | Acceptance check |
|---|---|
| Live URL | Public, loads < 3 s, works on mobile |
| 200+ posts | `SELECT count(*) FROM jobs WHERE is_active AND is_fresher` ≥ 200, all with working source link |
| Dedupe | Report: raw N → unique M, with examples of each dedupe layer firing |
| LLM tags | Every row has `role`, `city`, validated against enum; failures retried/flagged |
| Search | Text search + filters (role, city, type) + pagination |
| Daily refresh | Cron history shows ≥ 2 unattended runs; "last updated" visible on page |
| Video | 5–8 min: architecture, breakages, numbers |
| Repo | README, `.env.example`, one-command local run, `brain/` folder included |
| Accuracy | Gold CSV in repo; role / city / joint accuracy + confusion + CI |
| Cost | Token logs → $ per 1,000 posts, with assumptions stated |
