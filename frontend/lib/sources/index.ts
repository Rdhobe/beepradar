import type { QuotaClient } from "../http";
import type { RawJob } from "../prefilter";
import type { SourceConfig } from "../registry";
import { isAtsSource, makeAtsAdapter, GenericJsonAdapter } from "./ats";
import { isFeedSource, FeedAdapter } from "./feeds";
import { isAggregatorSource, makeAggregatorAdapter } from "./aggregators";
import { isLicensedApiSource, makeLicensedApiAdapter } from "./licensed_apis";
import { HnAdapter, GithubListsAdapter } from "./community";
import { CustomHttpAdapter } from "./custom_http";
import { JsonLdAdapter } from "./jsonld";

export interface SourceAdapter {
  fetch(client: QuotaClient, limit?: number): Promise<RawJob[]>;
}

export function getAdapter(source: SourceConfig): SourceAdapter | null {
  // Custom sources pick which built-in adapter logic to reuse via api.adapter;
  // source.id stays the attribution/dedupe identity.
  const id = (source.api.adapter as string) || source.id;
  if (id === "custom_http") return new CustomHttpAdapter(source);
  if (id === "generic_json") return new GenericJsonAdapter(source);
  if (isAtsSource(id)) return makeAtsAdapter(source);
  if (isFeedSource(id)) return new FeedAdapter(source);
  if (isAggregatorSource(id)) return makeAggregatorAdapter(source);
  if (isLicensedApiSource(id)) return makeLicensedApiAdapter(source);
  if (id === "hn_whoishiring") return new HnAdapter(source);
  if (id === "github_internship_lists") return new GithubListsAdapter(source);
  if (id === "jsonld_careers") return new JsonLdAdapter(source);
  return null;
}