import hashlib
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from bs4 import BeautifulSoup

TRACKING_PARAMS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
    "gclid", "fbclid", "msclkid", "mc_cid", "mc_eid", "ref", "ref_src", "ref_url",
    "source", "trk", "trkCampaign", "trackingId", "origin", "spm", "igshid",
}

LEGAL_SUFFIXES = re.compile(
    r"\b(pvt|private)\s*(ltd|limited)?\b|\b(ltd|limited|inc|incorporated|llp|llc|corp|corporation|co|company)\b"
    r"|\b(technologies|technology|solutions|software|labs|innovations|global|india)\b",
    re.I,
)

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
PHONE_RE = re.compile(r"(?<!\d)(?:\+91[\s-]?)?[6-9]\d{9}(?!\d)")

MAX_DESC_CHARS = 4000


def strip_html(html: str | None) -> str:
    if not html:
        return ""
    if "<" not in html and "&" not in html:
        return re.sub(r"\s+", " ", html).strip()
    text = BeautifulSoup(html, "html.parser").get_text(separator=" ")
    return re.sub(r"\s+", " ", text).strip()


def strip_pii(text: str) -> str:
    text = EMAIL_RE.sub("[email removed]", text)
    text = PHONE_RE.sub("[phone removed]", text)
    return text


def canonicalize_url(url: str) -> str:
    url = (url or "").strip()
    if not url:
        return ""
    parts = urlsplit(url)
    scheme = (parts.scheme or "https").lower()
    netloc = parts.netloc.lower()
    if netloc.startswith("www."):
        netloc = netloc[4:]
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=False)
             if k.lower() not in TRACKING_PARAMS and not k.lower().startswith("utm_")]
    query.sort()
    path = parts.path.rstrip("/") or "/"
    return urlunsplit((scheme, netloc, path, urlencode(query), ""))


def norm_company(company: str) -> str:
    s = company.lower()
    s = LEGAL_SUFFIXES.sub(" ", s)
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def norm_title(title: str) -> str:
    s = title.lower()
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def fingerprint(company: str, title: str, city_guess: str | None) -> str:
    blob = f"{norm_company(company)}|{norm_title(title)}|{city_guess or ''}"
    return hashlib.sha1(blob.encode("utf-8")).hexdigest()


def parse_date(value: str | None) -> str | None:
    if not value:
        return None
    value = str(value).strip()
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        pass
    try:
        dt = parsedate_to_datetime(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except (ValueError, TypeError):
        pass
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%m/%d/%Y", "%d %b %Y", "%b %d, %Y"):
        try:
            dt = datetime.strptime(value, fmt).replace(tzinfo=timezone.utc)
            return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        except ValueError:
            continue
    if value.isdigit():
        try:
            ts = int(value)
            if ts > 10**12:
                ts //= 1000
            return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        except (ValueError, OSError, OverflowError):
            return None
    return None


def clean_description(html_or_text: str | None) -> str:
    text = strip_html(html_or_text)
    text = strip_pii(text)
    return text[:MAX_DESC_CHARS]