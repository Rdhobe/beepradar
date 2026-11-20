import re

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .config import CORS_ORIGINS, load_registry
from .db import db, init_db
from .taxonomy import CITIES, JOB_TYPES, ROLES

app = FastAPI(title="BeepRadar API")
app.add_middleware(
    CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["GET"], allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    init_db()


def _fts_query(q: str) -> str:
    words = re.findall(r"[a-zA-Z0-9]+", q)
    return " AND ".join(f"{w}*" for w in words)


def _job_dict(row) -> dict:
    return {
        "id": row["id"], "title": row["title"], "company": row["company"],
        "location_raw": row["location_raw"], "role": row["role"], "city": row["city"],
        "job_type": row["job_type"], "is_fresher": bool(row["is_fresher"]),
        "tag_status": row["tag_status"], "tag_confidence": row["tag_confidence"],
        "source": row["source"], "url": row["apply_url"] or row["canonical_url"],
        "posted_at": row["posted_at"], "first_seen_at": row["first_seen_at"],
        "description_snippet": (row["description"] or "")[:300],
    }


@app.get("/api/jobs")
def search_jobs(
    q: str = "", role: str = "", city: str = "", type: str = "",
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
):
    where = ["j.is_active=1", "j.is_fresher=1", "j.tag_status != 'failed'"]
    params: list = []
    if role:
        where.append("j.role=?")
        params.append(role)
    if city:
        where.append("j.city=?")
        params.append(city)
    if type:
        where.append("j.job_type=?")
        params.append(type)
    join = ""
    order = "j.posted_at DESC NULLS LAST, j.first_seen_at DESC"
    if q.strip():
        join = "JOIN jobs_fts f ON f.rowid = j.id"
        where.append("jobs_fts MATCH ?")
        params.append(_fts_query(q))
        order = "f.rank"
    sql_where = " AND ".join(where)
    with db() as conn:
        total = conn.execute(
            f"SELECT count(*) c FROM jobs j {join} WHERE {sql_where}", params
        ).fetchone()["c"]
        rows = conn.execute(
            f"SELECT j.* FROM jobs j {join} WHERE {sql_where} ORDER BY {order} LIMIT ? OFFSET ?",
            [*params, page_size, (page - 1) * page_size],
        ).fetchall()
        last = conn.execute(
            "SELECT max(finished_at) t FROM ingest_runs WHERE error IS NULL"
        ).fetchone()["t"]
    return {"total": total, "page": page, "page_size": page_size,
            "last_refreshed": last, "results": [_job_dict(r) for r in rows]}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: int):
    with db() as conn:
        row = conn.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        if not row:
            raise HTTPException(404, "job not found")
        seen = conn.execute(
            "SELECT source, url, seen_at FROM job_sources_seen WHERE job_id=?", (job_id,)
        ).fetchall()
    out = _job_dict(row)
    out["description"] = row["description"]
    out["seen_via"] = [dict(s) for s in seen]
    return out


@app.get("/api/meta")
def meta():
    with db() as conn:
        counts = conn.execute(
            "SELECT count(*) total, sum(is_active) active, "
            "sum(CASE WHEN tag_status='done' THEN 1 ELSE 0 END) tagged, "
            "sum(CASE WHEN tag_status='pending' THEN 1 ELSE 0 END) pending, "
            "sum(CASE WHEN tag_status='failed' THEN 1 ELSE 0 END) failed FROM jobs"
        ).fetchone()
        last = conn.execute("SELECT max(finished_at) t FROM ingest_runs WHERE error IS NULL").fetchone()["t"]
        cities = [r["city"] for r in conn.execute(
            "SELECT DISTINCT city FROM jobs WHERE city IS NOT NULL AND is_active=1 ORDER BY city")]
        roles = [r["role"] for r in conn.execute(
            "SELECT DISTINCT role FROM jobs WHERE role IS NOT NULL AND is_active=1 ORDER BY role")]
    return {
        "roles": ROLES, "cities": CITIES, "job_types": JOB_TYPES,
        "available_cities": cities, "available_roles": roles,
        "counts": dict(counts), "last_refreshed": last,
    }


@app.get("/api/stats")
def stats():
    with db() as conn:
        runs = conn.execute(
            "SELECT source, count(*) runs, sum(fetched) fetched, sum(passed_filter) passed, "
            "sum(inserted) inserted, sum(dup_url) dup_url, sum(dup_fingerprint) dup_fingerprint, "
            "sum(dup_fuzzy) dup_fuzzy, max(finished_at) last_run "
            "FROM ingest_runs GROUP BY source ORDER BY inserted DESC"
        ).fetchall()
        llm = conn.execute(
            "SELECT count(*) calls, sum(input_tokens) input_tokens, sum(output_tokens) output_tokens, "
            "sum(cached_input_tokens) cached_tokens, sum(CASE WHEN ok=0 THEN 1 ELSE 0 END) failed_calls "
            "FROM llm_runs"
        ).fetchone()
        tagged = conn.execute("SELECT count(*) c FROM jobs WHERE tag_status='done'").fetchone()["c"]
        quota = conn.execute(
            "SELECT source_id, window, count FROM source_quota_usage WHERE window LIKE 'd:%' "
            "ORDER BY source_id"
        ).fetchall()
        states = conn.execute("SELECT * FROM source_state ORDER BY source_id").fetchall()
    cost = None
    if tagged and llm["input_tokens"]:
        cost = {
            "tagged_posts": tagged,
            "input_tokens_per_post": round(llm["input_tokens"] / tagged, 1),
            "output_tokens_per_post": round(llm["output_tokens"] / tagged, 1),
            "note": "multiply by provider price per token (read live on measurement day) for $/1000 posts",
        }
    return {
        "ingest_by_source": [dict(r) for r in runs],
        "llm_totals": dict(llm),
        "cost_inputs": cost,
        "quota_today": [dict(r) for r in quota],
        "source_state": [dict(r) for r in states],
    }


@app.get("/api/sources")
def sources():
    registry = load_registry()
    with db() as conn:
        states = {r["source_id"]: dict(r) for r in conn.execute("SELECT * FROM source_state")}
    out = []
    for s in registry["sources"]:
        out.append({
            "id": s["id"], "name": s["name"], "group": s["group"], "enabled": s["enabled"],
            "status": s["status"], "priority": s["priority"],
            "limits": s.get("limits", {}), "schedule": s.get("schedule", {}),
            "state": states.get(s["id"]),
        })
    return {"groups": registry["groups"], "sources": out}