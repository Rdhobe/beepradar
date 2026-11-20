import json
import os
import re
import time

from pydantic import ValidationError

from .cities import guess_city
from .config import LLM_BATCH_SIZE, LLM_MODEL
from .db import db
from .models import TagBatch
from .quota import iso, utcnow
from .taxonomy import CITIES, JOB_TYPES, ROLES

ROLE_DEFINITIONS = {
    "software_engineering": "general software development not clearly frontend/backend/fullstack",
    "frontend": "web UI work (React, HTML/CSS, browser)",
    "backend": "server-side APIs, services, databases",
    "fullstack": "explicitly both frontend and backend",
    "mobile": "Android/iOS/Flutter/React Native apps",
    "data_analytics": "SQL, dashboards, BI, business reporting",
    "data_science_ml": "ML models, statistics, AI research, data science",
    "devops_cloud": "infra, CI/CD, SRE, cloud platforms, kubernetes",
    "qa_testing": "testing, QA automation, SDET",
    "product_management": "product specs, roadmaps, PM roles",
    "design_ux": "UI/UX, graphic, product design",
    "marketing": "growth, SEO, social media, brand, performance marketing",
    "sales_bizdev": "sales, business development, account management",
    "content_writing": "copywriting, technical writing, editing, journalism",
    "hr_recruiting": "HR, talent acquisition, people ops",
    "finance_accounting": "accounting, audit, tax, financial analysis, treasury",
    "operations_supply_chain": "ops, logistics, supply chain, procurement",
    "customer_support": "support, success, service desks",
    "core_engineering": "mechanical/civil/electrical/electronics engineering",
    "other": "nothing above fits",
}

SYSTEM_PROMPT = (
    "You label Indian job posts for a student career platform.\n"
    'Return ONLY JSON: {"results":[{"id","role","city","job_type","is_fresher","confidence"}]}.\n\n'
    "ROLE must be exactly one of:\n"
    + "\n".join(f"- {r}: {d}" for r, d in ROLE_DEFINITIONS.items())
    + "\n\nCITY must be exactly one of: " + ", ".join(CITIES) + "\n"
    "City rules:\n"
    "- Use the primary work location. Gurugram/Noida/Gurgaon/Delhi => Delhi_NCR. Bangalore => Bengaluru.\n"
    "- Fully remote but India-eligible => Remote_India. Several cities listed => Multiple. Not stated => Unknown.\n"
    "- Never guess a city that is not in the text.\n"
    "ROLE rules:\n"
    "- Choose by the day-to-day work, not the company's industry.\n"
    "- If nothing fits => other.\n"
    "job_type is one of: internship, fresher_fulltime, apprenticeship, other.\n"
    "is_fresher = true if the post targets students/0-1 years/graduates/interns.\n"
    "confidence = your honest 0-1 confidence in role AND city together.\n"
    "Return one result per input id, no extras."
)


def _log_llm_run(conn, model, batch_size, usage, latency_ms, ok, error=None, retry_of=None):
    conn.execute(
        "INSERT INTO llm_runs (model, batch_size, input_tokens, output_tokens, cached_input_tokens, "
        "latency_ms, ok, retry_of, error) VALUES (?,?,?,?,?,?,?,?,?)",
        (model, batch_size, getattr(usage, "input_tokens", 0), getattr(usage, "output_tokens", 0),
         getattr(usage, "cache_read_input_tokens", 0) or 0, latency_ms, int(ok), retry_of, error),
    )
    conn.commit()


def _parse_response(text: str) -> TagBatch:
    text = text.strip()
    m = re.search(r"\{.*\}", text, re.S)
    if m:
        text = m.group(0)
    batch = TagBatch.model_validate_json(text)
    for tag in batch.results:
        if tag.role not in ROLES or tag.city not in CITIES or tag.job_type not in JOB_TYPES:
            raise ValueError(f"out-of-enum value in tag id={tag.id}: {tag.role}/{tag.city}/{tag.job_type}")
    return batch


def _call_llm(client, posts: list[dict], repair_error: str | None = None):
    user_content = json.dumps(posts, ensure_ascii=False)
    if repair_error:
        user_content = (
            f"Your last output failed validation: {repair_error}. Return corrected JSON only.\n\n"
            + user_content
        )
    started = time.monotonic()
    resp = client.messages.create(
        model=LLM_MODEL,
        max_tokens=4096,
        temperature=0,
        system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": user_content}],
    )
    latency = int((time.monotonic() - started) * 1000)
    text = "".join(b.text for b in resp.content if b.type == "text")
    return text, resp.usage, latency


def tag_pending(max_batches: int = 10) -> dict:
    if not os.getenv("ANTHROPIC_API_KEY"):
        return {"status": "skipped_no_key"}
    import anthropic

    client = anthropic.Anthropic()
    stats = {"tagged": 0, "failed": 0, "batches": 0, "city_mismatches": 0}
    with db() as conn:
        for _ in range(max_batches):
            rows = conn.execute(
                "SELECT id, title, company, location_raw, description FROM jobs "
                "WHERE tag_status='pending' ORDER BY first_seen_at LIMIT ?",
                (LLM_BATCH_SIZE,),
            ).fetchall()
            if not rows:
                break
            posts = [
                {"id": r["id"], "title": r["title"], "company": r["company"],
                 "location_raw": r["location_raw"] or "", "description": (r["description"] or "")[:1200]}
                for r in rows
            ]
            ids = {r["id"] for r in rows}
            batch = None
            retry_of = None
            try:
                text, usage, latency = _call_llm(client, posts)
                try:
                    batch = _parse_response(text)
                    _log_llm_run(conn, LLM_MODEL, len(posts), usage, latency, True)
                except (ValidationError, ValueError, json.JSONDecodeError) as e:
                    _log_llm_run(conn, LLM_MODEL, len(posts), usage, latency, False, str(e)[:300])
                    text2, usage2, latency2 = _call_llm(client, posts, repair_error=str(e)[:300])
                    retry_of = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
                    try:
                        batch = _parse_response(text2)
                        _log_llm_run(conn, LLM_MODEL, len(posts), usage2, latency2, True, retry_of=retry_of)
                    except (ValidationError, ValueError, json.JSONDecodeError) as e2:
                        _log_llm_run(conn, LLM_MODEL, len(posts), usage2, latency2, False, str(e2)[:300], retry_of)
                        conn.execute(
                            f"UPDATE jobs SET tag_status='failed' WHERE id IN ({','.join('?' * len(ids))})",
                            list(ids),
                        )
                        conn.commit()
                        stats["failed"] += len(ids)
                        continue
            except Exception as e:
                _log_llm_run(conn, LLM_MODEL, len(posts), None, 0, False, str(e)[:300])
                print(f"[tagger] API error, leaving batch pending: {e}")
                break
            stats["batches"] += 1
            seen = set()
            for tag in batch.results:
                if tag.id not in ids or tag.id in seen:
                    continue
                seen.add(tag.id)
                row = next(r for r in rows if r["id"] == tag.id)
                gaz = guess_city(row["location_raw"])
                if gaz and gaz not in ("Multiple", "Other_India", "Unknown") and tag.city != gaz:
                    stats["city_mismatches"] += 1
                conn.execute(
                    "UPDATE jobs SET role=?, city=?, job_type=?, is_fresher=?, tag_confidence=?, "
                    "tag_status='done', tagged_at=?, tag_model=? WHERE id=?",
                    (tag.role, tag.city, tag.job_type, int(tag.is_fresher), tag.confidence,
                     iso(utcnow()), LLM_MODEL, tag.id),
                )
                stats["tagged"] += 1
            missing = ids - seen
            if missing:
                print(f"[tagger] {len(missing)} ids missing from batch result — left pending")
            conn.commit()
    return {"status": "ok", **stats}