// Probe ATS board slugs and keep those returning 200 with >=1 India job.
// Writes data/ats_tokens.json consumed by the ATS adapters.
// Usage: npm run probe [platform ...]   (default: all platforms)
// Politeness: 1 req/s per platform host (10s for workable), 10s timeout.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { guessCity, isIndiaLocation } from "../lib/cities";
import { sourceConfig, USER_AGENT } from "../lib/registry";

const TOKENS_PATH = path.join(process.cwd(), "data", "ats_tokens.json");

const PROBE_TEMPLATES: Record<string, { template: string; locationsOf: (d: any) => string[] }> = {
  greenhouse: {
    template: "https://boards-api.greenhouse.io/v1/boards/{token}/jobs",
    locationsOf: (d) => (d?.jobs ?? []).map((j: any) => j.location?.name ?? ""),
  },
  lever: {
    template: "https://api.lever.co/v0/postings/{token}?mode=json",
    locationsOf: (d) => (Array.isArray(d) ? d : []).map((j: any) => j.categories?.location ?? ""),
  },
  ashby: {
    template: "https://api.ashbyhq.com/posting-api/job-board/{token}",
    locationsOf: (d) => (d?.jobs ?? []).map((j: any) => j.location ?? ""),
  },
  smartrecruiters: {
    template: "https://api.smartrecruiters.com/v1/companies/{token}/postings?limit=100",
    locationsOf: (d) => (d?.content ?? []).map((j: any) =>
      [j.location?.city, j.location?.country].filter(Boolean).join(", ")),
  },
  recruitee: {
    template: "https://{token}.recruitee.com/api/offers/",
    locationsOf: (d) => (d?.offers ?? []).map((j: any) => j.location ?? ""),
  },
  teamtailor: {
    template: "https://{token}.teamtailor.com/jobs.json",
    locationsOf: (d) => (d?.data ?? []).map((j: any) => j.attributes?.location ?? ""),
  },
  workable: {
    template: "https://apply.workable.com/api/v1/widget/accounts/{token}",
    locationsOf: (d) => (Array.isArray(d) ? [] : d?.jobs ?? []).map((j: any) =>
      [j.location?.city, j.location?.country].filter(Boolean).join(", ")),
  },
  polymer: {
    template: "https://api.polymer.co/v1/hire/organizations/{token}/jobs",
    locationsOf: (d) => (Array.isArray(d) ? d : d?.jobs ?? []).map((j: any) => String(j.location ?? "")),
  },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function probePlatform(platform: string): Promise<string[]> {
  const cfg = sourceConfig(platform);
  if (!cfg) return [];
  const { template, locationsOf } = PROBE_TEMPLATES[platform];
  const candidates = [...new Set([
    ...(cfg.api.known_india_tokens ?? []),
    ...(cfg.api.candidate_tokens ?? []),
  ])];
  const keep: string[] = [];
  for (const token of candidates) {
    const url = template.replaceAll("{token}", token);
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(10000),
        redirect: "follow",
      });
      if (resp.status === 200) {
        const locations = locationsOf(await resp.json());
        if (locations.some((loc) => loc && (isIndiaLocation(loc) || guessCity(loc)))) {
          keep.push(token);
          console.log(`  [HIT] ${platform}/${token} (${locations.length} jobs)`);
        }
      }
    } catch (e) {
      console.log(`  [err] ${platform}/${token}:`, e instanceof Error ? e.message : e);
    }
    await sleep(platform === "workable" ? 10000 : 1000);
  }
  return keep;
}

async function main() {
  const existing: Record<string, unknown[]> = existsSync(TOKENS_PATH)
    ? JSON.parse(readFileSync(TOKENS_PATH, "utf-8"))
    : {};
  const platforms = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(PROBE_TEMPLATES);
  for (const platform of platforms) {
    if (!(platform in PROBE_TEMPLATES)) {
      console.log(`skipping ${platform} (no probe template)`);
      continue;
    }
    console.log(`probing ${platform} ...`);
    const hits = await probePlatform(platform);
    const merged = [...new Set([...(existing[platform] ?? []), ...hits])];
    existing[platform] = merged;
    console.log(`  kept ${merged.length} tokens for ${platform}`);
    writeFileSync(TOKENS_PATH, JSON.stringify(existing, null, 2), "utf-8");
  }
  console.log(`saved ${TOKENS_PATH}`);
}

main();