import sqlite3

from rapidfuzz import fuzz

from .config import FUZZY_THRESHOLD
from .normalize import norm_company, norm_title


class DedupeIndex:
    """In-memory dedupe index over existing rows + rows inserted in the current batch.

    Layers: 1) canonical URL  2) fingerprint  3) fuzzy title (same company + city).
    """

    def __init__(self, conn: sqlite3.Connection):
        self.by_url: dict[str, int] = {}
        self.by_fp: dict[str, int] = {}
        self.fuzzy: list[tuple[int, str, str | None, str]] = []
        for row in conn.execute("SELECT id, canonical_url, fingerprint, company, title, city, location_raw FROM jobs"):
            self.by_url[row["canonical_url"]] = row["id"]
            self.by_fp[row["fingerprint"]] = row["id"]
            city = row["city"]
            self.fuzzy.append((row["id"], norm_company(row["company"]), city, norm_title(row["title"])))

    def find(self, canonical_url: str, fp: str, company: str, city: str | None, title: str) -> tuple[str, int] | None:
        if canonical_url in self.by_url:
            return ("url", self.by_url[canonical_url])
        if fp in self.by_fp:
            return ("fingerprint", self.by_fp[fp])
        c_norm = norm_company(company)
        t_norm = norm_title(title)
        for job_id, f_company, f_city, f_title in self.fuzzy:
            if f_company != c_norm:
                continue
            if city and f_city and city != f_city:
                continue
            if fuzz.ratio(t_norm, f_title) > FUZZY_THRESHOLD:
                return ("fuzzy", job_id)
        return None

    def add(self, job_id: int, canonical_url: str, fp: str, company: str, city: str | None, title: str) -> None:
        self.by_url[canonical_url] = job_id
        self.by_fp[fp] = job_id
        self.fuzzy.append((job_id, norm_company(company), city, norm_title(title)))