import os
from datetime import datetime, timezone

from ..httpclient import QuotaClient
from ..models import RawJob
from ..quota import QuotaExhausted


def _raw(sid, r):
    if not r.get("url") or not r.get("title"):
        return None
    return RawJob(source=sid, source_id=r.get("source_id"), url=r["url"], title=r["title"],
                  company=r.get("company") or "Unknown", location_raw=r.get("location_raw"),
                  description=r.get("description"), posted_at=r.get("posted_at"))


class AdzunaAdapter:
    def __init__(self, source: dict):
        self.source = source

    def fetch(self, client: QuotaClient, limit: int | None = None) -> list[RawJob]:
        api = self.source["api"]
        loop = api.get("query_loop", {})
        out: list[RawJob] = []
        try:
            for what in loop.get("what", ["intern"]):
                for where in loop.get("where", ["bangalore"]):
                    for page in range(1, loop.get("pages", 2) + 1):
                        url = api["base_url"].replace("{page}", str(page))
                        params = {
                            "app_id": os.environ["ADZUNA_APP_ID"],
                            "app_key": os.environ["ADZUNA_APP_KEY"],
                            "results_per_page": 50, "what": what, "where": where,
                            "sort_by": "date", "max_days_old": 14,
                        }
                        resp = client.get(url, params=params)
                        resp.raise_for_status()
                        results = resp.json().get("results", [])
                        for j in results:
                            out.append(_raw(self.source["id"], dict(
                                source_id=str(j.get("id")), url=j.get("redirect_url"),
                                title=j.get("title"), company=(j.get("company") or {}).get("display_name"),
                                location_raw=(j.get("location") or {}).get("display_name"),
                                description=j.get("description"), posted_at=j.get("created"))))
                        if not results:
                            break
        except QuotaExhausted:
            pass
        return [r for r in out if r][:limit] if limit else [r for r in out if r]


class JoobleAdapter:
    def __init__(self, source: dict):
        self.source = source

    def fetch(self, client: QuotaClient, limit: int | None = None) -> list[RawJob]:
        url = self.source["api"]["base_url"].replace("{api_key}", os.environ["JOOBLE_API_KEY"])
        out: list[RawJob] = []
        try:
            for keywords in ["intern", "fresher", "graduate trainee"]:
                for location in ["Bangalore", "Mumbai", "Delhi", "Hyderabad", "Pune", "Chennai"]:
                    for page in (1, 2):
                        resp = client.post(url, json={"keywords": keywords, "location": location, "page": page})
                        resp.raise_for_status()
                        jobs = resp.json().get("jobs", [])
                        for j in jobs:
                            out.append(_raw(self.source["id"], dict(
                                source_id=str(j.get("id")), url=j.get("link"), title=j.get("title"),
                                company=j.get("company"), location_raw=j.get("location"),
                                description=j.get("snippet"), posted_at=j.get("updated"))))
                        if not jobs:
                            break
        except QuotaExhausted:
            pass
        return [r for r in out if r][:limit] if limit else [r for r in out if r]


class CareerjetAdapter:
    def __init__(self, source: dict):
        self.source = source

    def fetch(self, client: QuotaClient, limit: int | None = None) -> list[RawJob]:
        api = self.source["api"]
        out: list[RawJob] = []
        try:
            for keywords in ["intern", "fresher", "graduate trainee"]:
                for location in ["Bangalore", "Mumbai", "Delhi", "Hyderabad", "Pune", "Chennai"]:
                    params = dict(api.get("params_example", {}))
                    params.update({"keywords": keywords, "location": location,
                                   "affid": os.environ["CAREERJET_API_KEY"], "page": 1})
                    resp = client.get(api["base_url"], params=params)
                    resp.raise_for_status()
                    for j in resp.json().get("jobs", []):
                        out.append(_raw(self.source["id"], dict(
                            source_id=str(j.get("id")), url=j.get("url"), title=j.get("title"),
                            company=j.get("company"), location_raw=j.get("locations"),
                            description=j.get("description"), posted_at=j.get("date"))))
        except QuotaExhausted:
            pass
        return [r for r in out if r][:limit] if limit else [r for r in out if r]


JSEARCH_QUERIES = [
    "fresher jobs in India",
    "internship in Bengaluru India",
    "internship in Mumbai India",
    "internship in Delhi NCR India",
    "internship in Hyderabad India",
    "internship in Pune India",
    "internship in Chennai India",
    "graduate trainee jobs in India",
    "entry level software engineer jobs in India",
    "data analyst intern jobs in India",
]


class JSearchAdapter:
    def __init__(self, source: dict):
        self.source = source

    def fetch(self, client: QuotaClient, limit: int | None = None) -> list[RawJob]:
        day = datetime.now(timezone.utc).timetuple().tm_yday
        query = JSEARCH_QUERIES[day % len(JSEARCH_QUERIES)]
        resp = client.get(
            self.source["api"]["base_url"],
            params={"query": query, "page": 1, "num_pages": 1, "gl": "in"},
            headers={"X-RapidAPI-Key": os.environ["RAPIDAPI_KEY"],
                     "X-RapidAPI-Host": "jsearch.p.rapidapi.com"},
        )
        resp.raise_for_status()
        out = []
        for j in resp.json().get("data", []):
            location = ", ".join(str(x) for x in [j.get("job_city"), j.get("job_state"), j.get("job_country")] if x)
            out.append(_raw(self.source["id"], dict(
                source_id=j.get("job_id"), url=j.get("job_apply_link"), title=j.get("job_title"),
                company=j.get("employer_name"), location_raw=location,
                description=j.get("job_description"), posted_at=j.get("job_posted_at_datetime_utc"))))
        return [r for r in out if r]


class ActiveJobsDbAdapter:
    def __init__(self, source: dict):
        self.source = source

    def fetch(self, client: QuotaClient, limit: int | None = None) -> list[RawJob]:
        api = self.source["api"]
        params = dict(api.get("params_example", {}))
        params["limit"] = 100
        resp = client.get(
            api["base_url"], params=params,
            headers={"X-RapidAPI-Key": os.environ["RAPIDAPI_KEY"],
                     "X-RapidAPI-Host": "active-jobs-db.p.rapidapi.com"},
        )
        resp.raise_for_status()
        data = resp.json()
        jobs = data if isinstance(data, list) else None
        if jobs is None:
            for key in ("jobs", "data", "results", "items"):
                if isinstance(data.get(key), list):
                    jobs = data[key]
                    break
        out = []
        for j in jobs or []:
            if not isinstance(j, dict):
                continue
            loc = j.get("location") or j.get("locations")
            if isinstance(loc, list):
                loc = ", ".join(str(x) for x in loc)
            out.append(_raw(self.source["id"], dict(
                source_id=str(j.get("id")), url=j.get("url") or j.get("apply_url") or j.get("job_url"),
                title=j.get("title") or j.get("job_title"),
                company=j.get("company") or j.get("company_name") or j.get("organization"),
                location_raw=loc, description=j.get("description"),
                posted_at=j.get("posted_at") or j.get("date_posted"))))
        return [r for r in out if r]


AGGREGATORS = {
    "adzuna_in": AdzunaAdapter,
    "jooble_in": JoobleAdapter,
    "careerjet_in": CareerjetAdapter,
    "jsearch": JSearchAdapter,
    "active_jobs_db": ActiveJobsDbAdapter,
}