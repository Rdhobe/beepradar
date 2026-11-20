import json

from bs4 import BeautifulSoup

from ..config import load_ats_tokens
from ..httpclient import QuotaClient
from ..models import RawJob
from ..quota import QuotaExhausted


def _tokens(source: dict) -> list:
    sid = source["id"]
    tokens = load_ats_tokens().get(sid)
    if tokens:
        return tokens
    return source.get("api", {}).get("known_india_tokens", [])


def _entry_url(entry, template: str) -> str | None:
    if isinstance(entry, dict):
        return entry.get("url")
    return template.format(token=entry, company=entry, slug=entry, N=1, site="External", offset=0)


def _company_from(entry, token: str) -> str:
    if isinstance(entry, dict) and entry.get("company"):
        return entry["company"]
    return token.replace("-", " ").replace("_", " ").title()


def _gh(data, token):
    for j in data.get("jobs", []):
        yield dict(source_id=str(j.get("id")), url=j.get("absolute_url"), title=j.get("title"),
                   company=_company_from(token, token), location_raw=(j.get("location") or {}).get("name"),
                   description=j.get("content"), posted_at=j.get("updated_at"))


def _lever(data, token):
    for j in data if isinstance(data, list) else []:
        yield dict(source_id=j.get("id"), url=j.get("hostedUrl"), title=j.get("text"),
                   company=_company_from(token, token),
                   location_raw=(j.get("categories") or {}).get("location"),
                   description=j.get("descriptionPlain") or j.get("description"),
                   posted_at=str(j.get("createdAt")) if j.get("createdAt") else None)


def _ashby(data, token):
    for j in data.get("jobs", []):
        yield dict(source_id=j.get("id"), url=j.get("jobUrl"), title=j.get("title"),
                   company=_company_from(token, token), location_raw=j.get("location"),
                   description=j.get("descriptionHtml") or j.get("descriptionPlain"),
                   posted_at=j.get("publishedAt"))


def _smartrecruiters(data, token):
    for j in data.get("content", []):
        loc = j.get("location") or {}
        location = ", ".join(str(x) for x in [loc.get("city"), loc.get("region"), loc.get("country")] if x)
        if loc.get("remote"):
            location = (location + " (Remote)").strip()
        yield dict(source_id=str(j.get("id")), url=j.get("applyUrl") or j.get("ref"),
                   title=j.get("name"), company=(j.get("company") or {}).get("name") or _company_from(token, token),
                   location_raw=location, description=None, posted_at=j.get("releasedDate"))


def _recruitee(data, token):
    for j in data.get("offers", []):
        yield dict(source_id=str(j.get("id")), url=j.get("careers_url"), title=j.get("title"),
                   company=_company_from(token, token), location_raw=j.get("location"),
                   description=j.get("description"), posted_at=j.get("created_at"))


def _personio_xml(text, token):
    soup = BeautifulSoup(text, "xml")
    for pos in soup.find_all("position"):
        pid = pos.findtext("id")
        yield dict(source_id=pid, url=f"https://{token}.jobs.personio.de/job/{pid}",
                   title=pos.findtext("name"), company=_company_from(token, token),
                   location_raw=pos.findtext("office"),
                   description=pos.findtext("job-description"), posted_at=pos.findtext("createdAt"))


def _teamtailor(data, token):
    included = {i.get("id"): i for i in data.get("included", []) if isinstance(i, dict)}
    for j in data.get("data", []):
        attrs = j.get("attributes") or {}
        locs = []
        rel = (j.get("relationships") or {}).get("locations", {}).get("data", [])
        for r in rel:
            inc = included.get(r.get("id"))
            if inc:
                locs.append((inc.get("attributes") or {}).get("name", ""))
        links = j.get("links") or {}
        yield dict(source_id=str(j.get("id")), url=links.get("self") or f"https://{token}.teamtailor.com/jobs/{j.get('id')}",
                   title=attrs.get("title"), company=_company_from(token, token),
                   location_raw=", ".join(l for l in locs if l) or attrs.get("location"),
                   description=attrs.get("body") or attrs.get("pitch"),
                   posted_at=attrs.get("created-at") or attrs.get("published-at"))


def _workable(data, token):
    jobs = data.get("jobs", []) if isinstance(data, dict) else data
    for j in jobs or []:
        loc = j.get("location") or {}
        location = ", ".join(str(x) for x in [loc.get("city"), loc.get("country")] if x)
        yield dict(source_id=str(j.get("id") or j.get("shortcode")),
                   url=j.get("url") or j.get("shortlink") or f"https://apply.workable.com/{token}/j/{j.get('shortcode')}/",
                   title=j.get("title"), company=_company_from(token, token),
                   location_raw=location or j.get("location_str"),
                   description=j.get("description"), posted_at=j.get("published_on") or j.get("created_at"))


def _generic_json(data, token):
    jobs = data if isinstance(data, list) else None
    if jobs is None and isinstance(data, dict):
        for key in ("jobs", "positions", "result", "data", "offers", "content", "items", "openings"):
            if isinstance(data.get(key), list):
                jobs = data[key]
                break
    for j in jobs or []:
        if not isinstance(j, dict):
            continue
        loc = j.get("location")
        if isinstance(loc, dict):
            loc = ", ".join(str(x) for x in [loc.get("name"), loc.get("city"), loc.get("country")] if x)
        elif isinstance(loc, list):
            loc = ", ".join(str(x) for x in loc)
        company = j.get("company") or j.get("company_name") or j.get("organization")
        if isinstance(company, dict):
            company = company.get("name")
        yield dict(
            source_id=str(j.get("id") or j.get("shortcode") or ""),
            url=j.get("url") or j.get("apply_url") or j.get("jobUrl") or j.get("careers_url") or j.get("hostedUrl"),
            title=j.get("title") or j.get("name") or j.get("jobOpeningName") or j.get("position"),
            company=company or _company_from(token, token),
            location_raw=loc or j.get("locationsText"),
            description=j.get("description") or j.get("descriptionHtml") or j.get("body"),
            posted_at=j.get("published_date") or j.get("publishedAt") or j.get("created_at") or j.get("datePosted"),
        )


PLATFORMS = {
    "greenhouse": ("https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true", _gh, "json"),
    "lever": ("https://api.lever.co/v0/postings/{token}?mode=json", _lever, "json"),
    "ashby": ("https://api.ashbyhq.com/posting-api/job-board/{token}", _ashby, "json"),
    "smartrecruiters": ("https://api.smartrecruiters.com/v1/companies/{token}/postings?limit=100&offset={offset}", _smartrecruiters, "json_paginated"),
    "recruitee": ("https://{token}.recruitee.com/api/offers/", _recruitee, "json"),
    "personio": ("https://{token}.jobs.personio.de/xml", _personio_xml, "xml"),
    "teamtailor": ("https://{token}.teamtailor.com/jobs.json", _teamtailor, "json"),
    "workable": ("https://apply.workable.com/api/v1/widget/accounts/{token}?details=true", _workable, "json"),
    "polymer": ("https://api.polymer.co/v1/hire/organizations/{token}/jobs", _generic_json, "json"),
}

CONFIGURED_URL_PLATFORMS = {
    "breezy", "bamboohr", "pinpoint", "rippling_ats", "comeet", "jazzhr", "oracle_recruiting",
}


class AtsAdapter:
    def __init__(self, source: dict):
        self.source = source
        self.template, self.extract, self.kind = PLATFORMS[source["id"]]

    def fetch(self, client: QuotaClient, limit: int | None = None) -> list[RawJob]:
        out: list[RawJob] = []
        for entry in _tokens(self.source):
            token = entry if isinstance(entry, str) else entry.get("token", "")
            url = _entry_url(entry, self.template)
            if not url:
                continue
            try:
                if self.kind == "json_paginated":
                    offset = 0
                    while True:
                        data = client.get_json(self.template.format(token=token, offset=offset))
                        if not data:
                            break
                        batch = list(self.extract(data, token))
                        out.extend(self._to_raw(batch))
                        if len(data.get("content", [])) < 100:
                            break
                        offset += 100
                elif self.kind == "xml":
                    resp = client.get(url, use_cache=True)
                    if resp is None:
                        continue
                    resp.raise_for_status()
                    out.extend(self._to_raw(list(self.extract(resp.text, token))))
                else:
                    data = client.get_json(url, use_cache=True)
                    if data is None:
                        continue
                    out.extend(self._to_raw(list(self.extract(data, token))))
            except QuotaExhausted:
                break
            except Exception as e:
                print(f"[{self.source['id']}] token {token}: {e}")
                continue
            if limit and len(out) >= limit:
                break
        return out[:limit] if limit else out

    def _to_raw(self, rows: list[dict]) -> list[RawJob]:
        out = []
        for r in rows:
            if not r.get("url") or not r.get("title"):
                continue
            out.append(RawJob(source=self.source["id"], source_id=r.get("source_id"), url=r["url"],
                              title=r["title"], company=r.get("company") or "Unknown",
                              location_raw=r.get("location_raw"), description=r.get("description"),
                              posted_at=r.get("posted_at")))
        return out


class ConfiguredUrlAdapter(AtsAdapter):
    """For platforms whose exact endpoint must be verified by the probe script first.
    Runs only on entries with a confirmed 'url' in data/ats_tokens.json."""

    def __init__(self, source: dict):
        self.source = source
        self.template = ""
        self.extract = _generic_json
        self.kind = "json"

    def fetch(self, client: QuotaClient, limit: int | None = None) -> list[RawJob]:
        entries = [e for e in _tokens(self.source) if isinstance(e, dict) and e.get("url")]
        if not entries:
            print(f"[{self.source['id']}] no verified URLs in ats_tokens.json — run scripts/probe_boards.py first")
            return []
        out: list[RawJob] = []
        for entry in entries:
            try:
                if self.source["id"] == "jazzhr":
                    resp = client.get(entry["url"], use_cache=True)
                    if resp is None:
                        continue
                    resp.raise_for_status()
                    rows = list(_personio_xml(resp.text, entry.get("token", "")))
                else:
                    data = client.get_json(entry["url"], use_cache=True)
                    if data is None:
                        continue
                    rows = list(self.extract(data, entry.get("token", "")))
                out.extend(self._to_raw(rows))
            except QuotaExhausted:
                break
            except Exception as e:
                print(f"[{self.source['id']}] {entry.get('url')}: {e}")
        return out[:limit] if limit else out


class WorkdayAdapter:
    def __init__(self, source: dict):
        self.source = source

    def fetch(self, client: QuotaClient, limit: int | None = None) -> list[RawJob]:
        out: list[RawJob] = []
        entries = [e for e in _tokens(self.source) if isinstance(e, dict) and e.get("url")]
        if not entries:
            print("[workday_cxs] no verified tenant URLs in ats_tokens.json — run probe first")
            return []
        for entry in entries:
            base = entry["url"].rstrip("/")
            offset = 0
            try:
                while True:
                    resp = client.post(base, json={"searchText": "", "limit": 20, "offset": offset})
                    resp.raise_for_status()
                    data = resp.json()
                    postings = data.get("jobPostings", [])
                    for j in postings:
                        path = j.get("externalPath") or ""
                        out.append(RawJob(
                            source="workday_cxs", source_id=j.get("bulletFields", [""])[0] if j.get("bulletFields") else None,
                            url=base.split("/wday/cxs")[0] + path,
                            title=j.get("title", ""), company=entry.get("company", "Unknown"),
                            location_raw=j.get("locationsText"), description=None,
                            posted_at=j.get("postedOn"),
                        ))
                    total = data.get("total", 0)
                    offset += 20
                    if offset >= min(total, 2000) or not postings:
                        break
            except QuotaExhausted:
                break
            except Exception as e:
                print(f"[workday_cxs] {base}: {e}")
        return out[:limit] if limit else out