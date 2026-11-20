import json
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser

from bs4 import BeautifulSoup

from ..config import CAREER_SEEDS_PATH, USER_AGENT
from ..httpclient import QuotaClient
from ..models import RawJob
from ..prefilter import is_blocked_url
from ..quota import QuotaExhausted


class JsonLdAdapter:
    def __init__(self, source: dict):
        self.source = source
        self._robots: dict[str, RobotFileParser] = {}

    def _allowed(self, url: str) -> bool:
        parts = urlsplit(url)
        host = f"{parts.scheme}://{parts.netloc}"
        if host not in self._robots:
            rp = RobotFileParser()
            rp.set_url(host + "/robots.txt")
            try:
                rp.read()
            except Exception:
                rp.parse([])
            self._robots[host] = rp
        return self._robots[host].can_fetch(USER_AGENT, url)

    def fetch(self, client: QuotaClient, limit: int | None = None) -> list[RawJob]:
        if not CAREER_SEEDS_PATH.exists():
            print("[jsonld_careers] no data/career_pages.txt seed file — skipping")
            return []
        seeds = [l.strip() for l in CAREER_SEEDS_PATH.read_text(encoding="utf-8").splitlines()
                 if l.strip() and not l.startswith("#")]
        out: list[RawJob] = []
        try:
            for url in seeds:
                if is_blocked_url(url) or not self._allowed(url):
                    continue
                resp = client.get(url, use_cache=True)
                if resp is None:
                    continue
                resp.raise_for_status()
                out.extend(self._extract(resp.text, url))
                if limit and len(out) >= limit:
                    break
        except QuotaExhausted:
            pass
        return out[:limit] if limit else out

    def _extract(self, html: str, page_url: str) -> list[RawJob]:
        soup = BeautifulSoup(html, "html.parser")
        out = []
        for script in soup.find_all("script", type="application/ld+json"):
            try:
                data = json.loads(script.string or "")
            except (json.JSONDecodeError, TypeError):
                continue
            items = data if isinstance(data, list) else [data]
            for item in items:
                if isinstance(item, dict) and "@graph" in item:
                    items.extend(item["@graph"])
            for item in items:
                if not isinstance(item, dict) or item.get("@type") != "JobPosting":
                    continue
                org = item.get("hiringOrganization") or {}
                locations = item.get("jobLocation") or []
                if isinstance(locations, dict):
                    locations = [locations]
                loc_names = []
                for loc in locations:
                    addr = (loc or {}).get("address") or {}
                    loc_names.append(", ".join(str(x) for x in [addr.get("addressLocality"), addr.get("addressRegion"), addr.get("addressCountry")] if x))
                out.append(RawJob(
                    source="jsonld_careers", source_id=item.get("identifier") if isinstance(item.get("identifier"), str) else None,
                    url=item.get("url") or page_url, title=item.get("title", ""),
                    company=org.get("name") if isinstance(org, dict) else str(org),
                    location_raw="; ".join(l for l in loc_names if l),
                    description=item.get("description"), posted_at=item.get("datePosted"),
                ))
        return out