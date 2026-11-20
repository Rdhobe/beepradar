import re
from urllib.parse import urlsplit

from .cities import is_india_location
from .config import blocklist_domains
from .models import RawJob

FRESHER_KEYWORDS = [
    "intern", "internship", "fresher", "freshers", "graduate", "trainee",
    "entry level", "entry-level", "apprentice", "apprenticeship", "associate",
    "sde 1", "sde-1", "sde i", "0-1 years", "0-2 years", "0-1 year", "0-2 year",
    "batch of 2025", "batch of 2026", "batch of 2027", "campus", "new grad",
    "new-grad", "recent graduate", "no experience", "0 years",
]

SENIOR_TITLE_RE = re.compile(
    r"\b(senior|sr\.?|lead|principal|staff|manager|director|head of|vp|vice president"
    r"|chief|architect|expert|specialist|consultant)\b"
    r"|\b([3-9]|1[0-9])\+?\s*(?:-\s*\d+\s*)?years?\b",
    re.I,
)

SCAM_RE = re.compile(
    r"registration fee|registration charges|fee to apply|apply fee|security deposit"
    r"|pay (?:a |the )?(?:fee|amount|charge)|training fee|refundable deposit"
    r"|whatsapp (?:us|your resume)|send (?:your )?resume (?:on|to) whatsapp",
    re.I,
)


def is_blocked_url(url: str, blocklist: list[str] | None = None) -> bool:
    if not url:
        return False
    host = urlsplit(url).netloc.lower().split(":")[0]
    if host.startswith("www."):
        host = host[4:]
    for domain in blocklist if blocklist is not None else blocklist_domains():
        if host == domain or host.endswith("." + domain):
            return True
    return False


def fresher_heuristic(job: RawJob) -> bool:
    title = job.title.lower()
    if SENIOR_TITLE_RE.search(title):
        return False
    blob = f"{title} {(job.description or '')[:2000].lower()}"
    return any(kw in blob for kw in FRESHER_KEYWORDS)


def prefilter(job: RawJob) -> tuple[bool, bool, str | None]:
    """Returns (is_india, is_fresher, reject_reason). reject_reason set => drop row."""
    if is_blocked_url(job.url):
        return False, False, "blocklisted_url"
    if job.description and SCAM_RE.search(job.description[:3000]):
        return False, False, "scam_signal"
    india = is_india_location(job.location_raw, job.description)
    if not india:
        return False, False, "not_india"
    fresher = fresher_heuristic(job)
    if not fresher:
        return True, False, "not_fresher"
    return True, True, None