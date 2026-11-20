import feedparser

from ..httpclient import QuotaClient
from ..models import RawJob
from ..quota import QuotaExhausted


def _raw(source_id, r):
    if not r.get("url") or not r.get("title"):
        return None
    return RawJob(source=source_id, source_id=r.get("source_id"), url=r["url"], title=r["title"],
                  company=r.get("company") or "Unknown", location_raw=r.get("location_raw"),
                  description=r.get("description"), posted_at=r.get("posted_at"))


def _himalayas(client, source, limit, out):
    cursor = None
    base = source["api"]["base_url"]
    while True:
        url = f"{base}?limit=20" + (f"&cursor={cursor}" if cursor else "")
        data = client.get_json(url)
        if not data:
            break
        for j in data.get("jobs", []):
            restrictions = j.get("locationRestrictions") or []
            out.append(_raw(source["id"], dict(
                source_id=str(j.get("id")), url=j.get("applicationLink"), title=j.get("title"),
                company=j.get("companyName"), location_raw=", ".join(restrictions) or "Remote",
                description=j.get("description"), posted_at=j.get("pubDate"))))
        cursor = data.get("nextCursor")
        if not cursor or not data.get("jobs") or (limit and len(out) >= limit):
            break


def _remotive(client, source, limit, out):
    data = client.get_json(source["api"]["base_url"] + "?category=software-dev")
    for j in (data or {}).get("jobs", []):
        out.append(_raw(source["id"], dict(
            source_id=str(j.get("id")), url=j.get("url"), title=j.get("title"),
            company=j.get("company_name"), location_raw=j.get("candidate_required_location"),
            description=j.get("description"), posted_at=j.get("publication_date"))))


def _jobicy(client, source, limit, out):
    data = client.get_json(source["api"]["base_url"] + "?count=100&geo=apac")
    for j in (data or {}).get("jobs", []):
        out.append(_raw(source["id"], dict(
            source_id=str(j.get("id")), url=j.get("url"), title=j.get("jobTitle"),
            company=j.get("companyName"), location_raw=j.get("jobGeo"),
            description=j.get("jobDescription") or j.get("jobExcerpt"), posted_at=j.get("pubDate"))))


def _remoteok(client, source, limit, out):
    data = client.get_json(source["api"]["base_url"])
    for j in data if isinstance(data, list) else []:
        if not isinstance(j, dict) or "legal" in j:
            continue
        out.append(_raw(source["id"], dict(
            source_id=str(j.get("id")), url=j.get("url") or f"https://remoteok.com/remote-jobs/{j.get('id')}",
            title=j.get("position"), company=j.get("company"), location_raw=j.get("location"),
            description=j.get("description"), posted_at=j.get("date"))))


def _rss(client, source, limit, out):
    feeds = source["api"].get("feeds") or [source["api"]["base_url"]]
    for feed_url in feeds[:3]:
        resp = client.get(feed_url, use_cache=True)
        if resp is None:
            continue
        resp.raise_for_status()
        parsed = feedparser.parse(resp.text)
        for e in parsed.entries:
            company = e.get("author") or ""
            title = e.get("title", "")
            if not company and ":" in title:
                company, _, title = title.partition(":")
            out.append(_raw(source["id"], dict(
                source_id=e.get("id") or e.get("link"), url=e.get("link"), title=title.strip(),
                company=company.strip() or "Unknown", location_raw=e.get("location"),
                description=e.get("summary"), posted_at=e.get("published"))))


def _workingnomads(client, source, limit, out):
    data = client.get_json(source["api"]["base_url"])
    for j in data if isinstance(data, list) else []:
        out.append(_raw(source["id"], dict(
            source_id=str(j.get("id")), url=j.get("url"), title=j.get("title"),
            company=j.get("company_name"), location_raw=j.get("location"),
            description=j.get("description"), posted_at=j.get("pub_date"))))


def _fourdayweek(client, source, limit, out):
    data = client.get_json(source["api"]["base_url"])
    jobs = data if isinstance(data, list) else (data or {}).get("jobs", [])
    out = []
    for j in jobs:
        loc = j.get("location") or j.get("locations")
        if isinstance(loc, list):
            loc = ", ".join(str(x) for x in loc)
        out.append(_raw(source["id"], dict(
            source_id=str(j.get("id")), url=j.get("url") or j.get("apply_url"),
            title=j.get("title") or j.get("position"), company=j.get("company") or j.get("company_name"),
            location_raw=loc, description=j.get("description"), posted_at=j.get("posted_at") or j.get("date"))))


def _arbeitnow(client, source, limit, out):
    for page in range(1, 6):
        data = client.get_json(source["api"]["base_url"] + f"?page={page}")
        rows = (data or {}).get("data", [])
        if not rows:
            break
        for j in rows:
            out.append(_raw(source["id"], dict(
                source_id=j.get("slug"), url=j.get("url"), title=j.get("title"),
                company=j.get("company_name"), location_raw=j.get("location"),
                description=j.get("description"), posted_at=str(j.get("created_at")))))


def _themuse(client, source, limit, out):
    for page in range(1, 21):
        data = client.get_json(source["api"]["base_url"] + f"?page={page}")
        rows = (data or {}).get("results", [])
        if not rows:
            break
        for j in rows:
            out.append(_raw(source["id"], dict(
                source_id=str(j.get("id")), url=(j.get("refs") or {}).get("landing_page"),
                title=j.get("name"), company=(j.get("company") or {}).get("name"),
                location_raw=", ".join(l.get("name", "") for l in j.get("locations", [])),
                description=j.get("contents"), posted_at=j.get("publication_date"))))
        if page >= (data or {}).get("page_count", 1):
            break


FEEDS = {
    "himalayas": _himalayas,
    "remotive": _remotive,
    "jobicy": _jobicy,
    "remoteok": _remoteok,
    "weworkremotely_rss": _rss,
    "workingnomads": _workingnomads,
    "fourdayweek": _fourdayweek,
    "arbeitnow": _arbeitnow,
    "themuse": _themuse,
}


class FeedAdapter:
    def __init__(self, source: dict):
        self.source = source
        self.fn = FEEDS[source["id"]]

    def fetch(self, client: QuotaClient, limit: int | None = None) -> list[RawJob]:
        out: list[RawJob] = []
        try:
            self.fn(client, self.source, limit, out)
        except QuotaExhausted:
            pass
        out = [r for r in out if r is not None]
        return out[:limit] if limit else out