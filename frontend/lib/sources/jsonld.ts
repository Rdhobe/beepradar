import { readFileSync } from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import type { QuotaClient } from "../http";
import { isBlockedUrl, type RawJob } from "../prefilter";
import { QuotaExhausted } from "../quota";
import { USER_AGENT, type SourceConfig } from "../registry";

interface RobotsRules { allow: string[]; disallow: string[] }

function parseRobots(txt: string): RobotsRules {
  const rules: RobotsRules = { allow: [], disallow: [] };
  let applies = false;
  let sawAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "user-agent") {
      if (sawAgent && !applies) continue;
      applies = value === "*" || USER_AGENT.toLowerCase().includes(value.toLowerCase());
      sawAgent = true;
    } else if (applies && (field === "allow" || field === "disallow")) {
      if (value) rules[field].push(value);
    }
  }
  return rules;
}

function robotsAllows(rules: RobotsRules, pathname: string): boolean {
  let best = "";
  let allowed = true;
  for (const p of rules.allow) {
    if (pathname.startsWith(p) && p.length >= best.length) { best = p; allowed = true; }
  }
  for (const p of rules.disallow) {
    if (pathname.startsWith(p) && p.length > best.length) { best = p; allowed = false; }
  }
  return allowed;
}

export class JsonLdAdapter {
  private robots = new Map<string, RobotsRules>();

  constructor(private source: SourceConfig) {}

  private async allowed(url: string): Promise<boolean> {
    const u = new URL(url);
    const host = `${u.protocol}//${u.host}`;
    if (!this.robots.has(host)) {
      let rules: RobotsRules = { allow: [], disallow: [] };
      try {
        const resp = await fetch(host + "/robots.txt", {
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(10000),
        });
        if (resp.ok) rules = parseRobots(await resp.text());
        else if (resp.status === 401 || resp.status === 403) rules = { allow: [], disallow: ["/"] };
      } catch { /* unreachable robots.txt → allow */ }
      this.robots.set(host, rules);
    }
    return robotsAllows(this.robots.get(host)!, u.pathname);
  }

  async fetch(client: QuotaClient, limit?: number): Promise<RawJob[]> {
    const configPages = this.source.api.pages as string[] | undefined;
    let seeds: string[];
    if (configPages?.length) {
      seeds = configPages.map((l) => l.trim()).filter(Boolean);
    } else {
      let seedsText: string;
      try {
        seedsText = readFileSync(path.join(process.cwd(), "data", "career_pages.txt"), "utf-8");
      } catch {
        console.log("[jsonld_careers] no data/career_pages.txt seed file — skipping");
        return [];
      }
      seeds = seedsText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    }
    const out: RawJob[] = [];
    try {
      for (const url of seeds) {
        if (isBlockedUrl(url) || !(await this.allowed(url))) continue;
        const resp = await client.get(url, { useCache: true });
        if (resp === null) continue;
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        out.push(...extractJsonLd(await resp.text(), url, this.source.id));
        if (limit && out.length >= limit) break;
      }
    } catch (e) {
      if (!(e instanceof QuotaExhausted)) throw e;
    }
    return limit ? out.slice(0, limit) : out;
  }
}

export function extractJsonLd(html: string, pageUrl: string, sourceId = "jsonld_careers"): RawJob[] {
  const $ = cheerio.load(html);
  const out: RawJob[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    let data: any;
    try {
      data = JSON.parse($(el).text());
    } catch { return; }
    const items: any[] = Array.isArray(data) ? [...data] : [data];
    for (const item of [...items]) {
      if (item && typeof item === "object" && Array.isArray(item["@graph"])) items.push(...item["@graph"]);
    }
    for (const item of items) {
      if (!item || typeof item !== "object" || item["@type"] !== "JobPosting") continue;
      const org = item.hiringOrganization ?? {};
      let locations = item.jobLocation ?? [];
      if (!Array.isArray(locations)) locations = [locations];
      const locNames = locations.map((loc: any) => {
        const addr = loc?.address ?? {};
        return [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean).join(", ");
      });
      if (!item.title) continue;
      out.push({
        source: sourceId,
        sourceId: typeof item.identifier === "string" ? item.identifier : null,
        url: item.url ?? pageUrl, title: item.title,
        company: typeof org === "object" ? org.name : String(org),
        locationRaw: locNames.filter(Boolean).join("; "),
        description: item.description, postedAt: item.datePosted,
      });
    }
  });
  return out;
}