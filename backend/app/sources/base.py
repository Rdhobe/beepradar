from typing import Protocol

from ..httpclient import QuotaClient
from ..models import RawJob


class Adapter(Protocol):
    def fetch(self, client: QuotaClient, limit: int | None = None) -> list[RawJob]: ...


def get_adapter(source: dict) -> Adapter | None:
    from . import aggregators, ats, community, feeds, jsonld

    sid = source["id"]
    if sid in ats.PLATFORMS:
        return ats.AtsAdapter(source)
    if sid in ats.CONFIGURED_URL_PLATFORMS:
        return ats.ConfiguredUrlAdapter(source)
    if sid == "workday_cxs":
        return ats.WorkdayAdapter(source)
    if sid in feeds.FEEDS:
        return feeds.FeedAdapter(source)
    if sid in aggregators.AGGREGATORS:
        return aggregators.AGGREGATORS[sid](source)
    if sid == "hn_whoishiring":
        return community.HnAdapter(source)
    if sid == "github_internship_lists":
        return community.GithubListsAdapter(source)
    if sid == "jsonld_careers":
        return jsonld.JsonLdAdapter(source)
    return None