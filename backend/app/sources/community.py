import re

from ..httpclient import QuotaClient
from ..models import RawJob
from ..normalize import strip_html
from ..quota import QuotaExhausted


class HnAdapter:
    def __init__(self, source: dict):
        self.source = source

    def fetch(self, client: QuotaClient, limit: int | None = None) -> list[RawJob]:
        data = client.get_json(self.source["api"]["base_url"])
        hits = (data or {}).get("hits", [])
        if not hits:
            return []
        thread_id = hits[0]["objectID"]
        thread = client.get_json(f"https://hacker-news.firebaseio.com/v0/item/{thread_id}.json")
        out: list[RawJob] = []
        try:
            for kid in (thread or {}).get("kids", []):
                item = client.get_json(f"https://hacker-news.firebaseio.com/v0/item/{kid}.json")
                if not item or item.get("deleted") or item.get("dead") or not item.get("text"):
                    continue
                text = strip_html(item["text"])
                first_line = text.split("\n")[0][:200]
                company = re.split(r"\s*[|–—]\s*", first_line)[0][:100]
                out.append(RawJob(
                    source="hn_whoishiring", source_id=str(kid),
                    url=f"https://news.ycombinator.com/item?id={kid}",
                    title=first_line[:150], company=company or "Unknown",
                    location_raw=first_line, description=text,
                    posted_at=str(item.get("time")),
                ))
                if limit and len(out) >= limit:
                    break
        except QuotaExhausted:
            pass
        return out


LINK_RE = re.compile(r"\((https?://[^)\s]+)\)|(https?://[^\s|)]+)")


def _cell_link(cell: str) -> str | None:
    m = LINK_RE.search(cell)
    return (m.group(1) or m.group(2)) if m else None


def _clean_cell(cell: str) -> str:
    cell = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", cell)
    return re.sub(r"[*_`]", "", cell).strip()


class GithubListsAdapter:
    def __init__(self, source: dict):
        self.source = source

    def fetch(self, client: QuotaClient, limit: int | None = None) -> list[RawJob]:
        out: list[RawJob] = []
        for repo in self.source["api"].get("repos", []):
            url = self.source["api"]["base_url"].replace("{repo}", repo["repo"])
            try:
                resp = client.get(url, use_cache=True)
                if resp is None:
                    continue
                resp.raise_for_status()
                out.extend(self._parse_readme(resp.text, repo["repo"]))
            except QuotaExhausted:
                break
            except Exception as e:
                print(f"[github_lists] {repo['repo']}: {e}")
        return out[:limit] if limit else out

    def _parse_readme(self, md: str, repo: str) -> list[RawJob]:
        from ..cities import guess_city

        out = []
        lines = md.splitlines()
        i = 0
        while i < len(lines):
            line = lines[i].strip()
            if line.startswith("|") and i + 1 < len(lines) and re.match(r"^\|[\s:|-]+\|$", lines[i + 1].strip()):
                header = [_clean_cell(c).lower() for c in line.strip("|").split("|")]
                idx = {}
                for n, h in enumerate(header):
                    if "company" in h or "organization" in h:
                        idx["company"] = n
                    elif "position" in h or "role" in h or "title" in h:
                        idx["title"] = n
                    elif "location" in h:
                        idx["location"] = n
                    elif "link" in h or "application" in h or "apply" in h:
                        idx["link"] = n
                i += 2
                last_company = "Unknown"
                while i < len(lines) and lines[i].strip().startswith("|"):
                    cells = lines[i].strip().strip("|").split("|")
                    i += 1
                    if "title" not in idx or "link" not in idx or len(cells) <= max(idx.values()):
                        continue
                    link = _cell_link(cells[idx["link"]])
                    if not link:
                        continue
                    location = _clean_cell(cells[idx["location"]]) if "location" in idx else ""
                    if not (guess_city(location) or "india" in location.lower() or "remote" in location.lower()):
                        continue
                    company = _clean_cell(cells[idx["company"]])[:150] if "company" in idx else ""
                    if company and company not in ("↳", "-", "→"):
                        last_company = company
                    out.append(RawJob(
                        source="github_internship_lists", source_id=link,
                        url=link, title=_clean_cell(cells[idx["title"]])[:200],
                        company=last_company,
                        location_raw=location, description=f"From curated list {repo}",
                    ))
            else:
                i += 1
        return out