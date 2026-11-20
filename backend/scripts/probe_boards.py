"""Probe ATS board slugs and keep those returning 200 with >=1 India job.

Writes data/ats_tokens.json consumed by the ATS adapters.
Politeness: 1 req/s per platform host, 10s timeout, no retries on 404.
"""
import json
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.cities import guess_city, is_india_location
from app.config import ATS_TOKENS_PATH, USER_AGENT, source_config

PROBE_TEMPLATES = {
    "greenhouse": ("https://boards-api.greenhouse.io/v1/boards/{token}/jobs", lambda d: [
        (j.get("location") or {}).get("name", "") for j in d.get("jobs", [])]),
    "lever": ("https://api.lever.co/v0/postings/{token}?mode=json", lambda d: [
        (j.get("categories") or {}).get("location", "") for j in (d if isinstance(d, list) else [])]),
    "ashby": ("https://api.ashbyhq.com/posting-api/job-board/{token}", lambda d: [
        j.get("location", "") for j in d.get("jobs", [])]),
    "smartrecruiters": ("https://api.smartrecruiters.com/v1/companies/{token}/postings?limit=100", lambda d: [
        ", ".join(str(x) for x in [(j.get("location") or {}).get("city"), (j.get("location") or {}).get("country")] if x)
        for j in d.get("content", [])]),
    "recruitee": ("https://{token}.recruitee.com/api/offers/", lambda d: [
        j.get("location", "") for j in d.get("offers", [])]),
    "teamtailor": ("https://{token}.teamtailor.com/jobs.json", lambda d: [
        (j.get("attributes") or {}).get("location", "") or "" for j in d.get("data", [])]),
    "workable": ("https://apply.workable.com/api/v1/widget/accounts/{token}", lambda d: [
        ", ".join(str(x) for x in [(j.get("location") or {}).get("city"), (j.get("location") or {}).get("country")] if x)
        for j in (d.get("jobs", []) if isinstance(d, dict) else [])]),
    "polymer": ("https://api.polymer.co/v1/hire/organizations/{token}/jobs", lambda d: [
        str(j.get("location", "")) for j in (d if isinstance(d, list) else d.get("jobs", []))]),
}


def probe_platform(client: httpx.Client, platform: str) -> list[str]:
    cfg = source_config(platform)
    if not cfg:
        return []
    template, locations_of = PROBE_TEMPLATES[platform]
    candidates = list(dict.fromkeys(
        cfg["api"].get("known_india_tokens", []) + cfg["api"].get("candidate_tokens", [])
    ))
    keep = []
    for token in candidates:
        url = template.format(token=token)
        try:
            resp = client.get(url)
            if resp.status_code != 200:
                continue
            locations = locations_of(resp.json())
            if any(is_india_location(loc) or guess_city(loc) for loc in locations if loc):
                keep.append(token)
                print(f"  [HIT] {platform}/{token} ({len(locations)} jobs)")
        except Exception as e:
            print(f"  [err] {platform}/{token}: {e}")
        time.sleep(1.0 if platform != "workable" else 10.0)
    return keep


def main():
    existing = json.loads(ATS_TOKENS_PATH.read_text(encoding="utf-8")) if ATS_TOKENS_PATH.exists() else {}
    platforms = sys.argv[1:] or list(PROBE_TEMPLATES)
    with httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=10, follow_redirects=True, trust_env=False) as client:
        for platform in platforms:
            if platform not in PROBE_TEMPLATES:
                print(f"skipping {platform} (no probe template)")
                continue
            print(f"probing {platform} ...")
            hits = probe_platform(client, platform)
            merged = list(dict.fromkeys(existing.get(platform, []) + hits))
            existing[platform] = merged
            print(f"  kept {len(merged)} tokens for {platform}")
            ATS_TOKENS_PATH.parent.mkdir(parents=True, exist_ok=True)
            ATS_TOKENS_PATH.write_text(json.dumps(existing, indent=2), encoding="utf-8")
    print(f"saved {ATS_TOKENS_PATH}")


if __name__ == "__main__":
    main()