import type { SourceConfig } from "@/lib/registry";
import { secretStatus, type SecretStatus } from "@/lib/secrets";

export type IntegrationState = "off" | "available" | "connected" | "needs_connection";

export interface IntegrationInfo {
  category: string;
  state: IntegrationState;
  required_keys: string[];
  key_status: Record<string, SecretStatus>;
  boards: number;
}

const BY_ID: Record<string, string> = {
  greenhouse: "ATS boards", lever: "ATS boards", ashby: "ATS boards", smartrecruiters: "ATS boards",
  polymer: "ATS boards", recruitee: "ATS boards", personio: "ATS boards", teamtailor: "ATS boards",
  breezy: "ATS boards", bamboohr: "ATS boards", pinpoint: "ATS boards", rippling_ats: "ATS boards",
  comeet: "ATS boards", jazzhr: "ATS boards", workable: "ATS boards", workday_cxs: "ATS boards",
  oracle_recruiting: "ATS boards", icims: "ATS boards", successfactors: "ATS boards", homerun: "ATS boards",
  remotive: "Feeds", jobicy: "Feeds", remoteok: "Feeds", weworkremotely_rss: "Feeds",
  workingnomads: "Feeds", fourdayweek: "Feeds", arbeitnow: "Feeds", freejobalert_rss: "Feeds",
  jsonld_careers: "Career pages",
  hn_whoishiring: "Community", github_internship_lists: "Community", reddit_india_oauth: "Community",
  apify_naukri: "Apify Actors", apify_internshala: "Apify Actors", apify_foundit: "Apify Actors",
};

export function categoryOf(s: SourceConfig, custom: boolean): string {
  if (custom) return "Custom";
  return BY_ID[s.id] ?? "Job APIs";
}

export function requiredKeys(s: SourceConfig): string[] {
  return s.api.auth?.env ?? [];
}

export function boardCount(s: SourceConfig): number {
  const api = s.api as Record<string, any>;
  return (api.known_india_tokens?.length ?? 0) + (api.feeds?.length ?? 0) + (api.pages?.length ?? 0);
}

export async function integrationInfo(
  entries: { s: SourceConfig; custom: boolean }[],
): Promise<Map<string, IntegrationInfo>> {
  const names = new Set<string>();
  for (const { s } of entries) for (const k of requiredKeys(s)) names.add(k);
  const status = await secretStatus([...names]);
  const out = new Map<string, IntegrationInfo>();
  for (const { s, custom } of entries) {
    const req = requiredKeys(s);
    const ks: Record<string, SecretStatus> = {};
    for (const k of req) ks[k] = status[k] ?? { set: false, source: null, masked: null };
    const state: IntegrationState = !s.enabled
      ? "off"
      : req.length === 0
        ? "available"
        : req.every((k) => ks[k].set)
          ? "connected"
          : "needs_connection";
    out.set(s.id, { category: categoryOf(s, custom), state, required_keys: req, key_status: ks, boards: boardCount(s) });
  }
  return out;
}