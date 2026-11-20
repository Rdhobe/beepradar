import sqlite3

from .cities import guess_city
from .dedupe import DedupeIndex
from .models import RawJob
from .normalize import canonicalize_url, clean_description, fingerprint, parse_date, strip_html
from .prefilter import prefilter
from .quota import iso, utcnow


def ingest_raw_jobs(conn: sqlite3.Connection, source_id: str, raw_jobs: list[RawJob]) -> dict:
    started = iso(utcnow())
    cur = conn.execute(
        "INSERT INTO ingest_runs (source, started_at) VALUES (?,?)", (source_id, started)
    )
    run_id = cur.lastrowid
    counts = dict(fetched=len(raw_jobs), passed_filter=0, inserted=0,
                  dup_url=0, dup_fingerprint=0, dup_fuzzy=0)
    index = DedupeIndex(conn)
    try:
        for raw in raw_jobs:
            title = strip_html(raw.title)[:300]
            company = strip_html(raw.company)[:200]
            url = canonicalize_url(raw.url)
            if not title or not company or not url:
                continue
            job = RawJob(
                source=source_id, source_id=raw.source_id, url=url, title=title,
                company=company, location_raw=raw.location_raw,
                description=clean_description(raw.description), posted_at=raw.posted_at,
            )
            india, fresher, reject = prefilter(job)
            if reject:
                continue
            counts["passed_filter"] += 1
            city_guess = guess_city(job.location_raw) or guess_city((job.description or "")[:300])
            fp = fingerprint(job.company, job.title, city_guess)
            hit = index.find(url, fp, job.company, city_guess, job.title)
            if hit:
                layer, job_id = hit
                counts[f"dup_{layer}"] += 1
                conn.execute(
                    "UPDATE jobs SET last_seen_at=? WHERE id=?", (iso(utcnow()), job_id)
                )
                conn.execute(
                    "INSERT OR IGNORE INTO job_sources_seen (job_id, source, url) VALUES (?,?,?)",
                    (job_id, source_id, url),
                )
                continue
            cur = conn.execute(
                "INSERT INTO jobs (source, source_id, canonical_url, apply_url, title, company, "
                "location_raw, description, posted_at, fingerprint, is_india, is_fresher, city) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (source_id, job.source_id, url, raw.url, job.title, job.company,
                 job.location_raw, job.description, parse_date(job.posted_at), fp,
                 int(india), int(fresher), city_guess),
            )
            job_id = cur.lastrowid
            index.add(job_id, url, fp, job.company, city_guess, job.title)
            conn.execute(
                "INSERT OR IGNORE INTO job_sources_seen (job_id, source, url) VALUES (?,?,?)",
                (job_id, source_id, url),
            )
            counts["inserted"] += 1
        conn.commit()
    except Exception as e:
        conn.execute(
            "UPDATE ingest_runs SET finished_at=?, error=? WHERE id=?",
            (iso(utcnow()), str(e)[:500], run_id),
        )
        conn.commit()
        raise
    conn.execute(
        "UPDATE ingest_runs SET finished_at=?, fetched=?, passed_filter=?, inserted=?, "
        "dup_url=?, dup_fingerprint=?, dup_fuzzy=? WHERE id=?",
        (iso(utcnow()), counts["fetched"], counts["passed_filter"], counts["inserted"],
         counts["dup_url"], counts["dup_fingerprint"], counts["dup_fuzzy"], run_id),
    )
    conn.commit()
    return counts


def expire_stale(conn: sqlite3.Connection, days: int = 14) -> int:
    cur = conn.execute(
        "UPDATE jobs SET is_active=0 WHERE is_active=1 AND last_seen_at < strftime('%Y-%m-%dT%H:%M:%fZ','now',?)",
        (f"-{days} days",),
    )
    conn.commit()
    return cur.rowcount