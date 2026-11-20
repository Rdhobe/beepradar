import * as cheerio from "cheerio";
import tokensJson from "@/data/ats_tokens.json";
import type { QuotaClient } from "../http";
import type { RawJob } from "../prefilter";
import { QuotaExhausted } from "../quota";
import type { SourceConfig } from "../registry";

type TokenEntry = string | { token?: string; company?: string; url?: string };
const tokens = tokensJson as Record<string, TokenEntry[]>;

interface ExtractedRow {
  sourceId?: string | null;
  url?: string | null;
  title?: string | null;
  company?: string | null;
  locationRaw?: string | null;
  description?: string | null;
  postedAt?: string | null;
}

type Extractor = (data: any, token: string) => ExtractedRow[];

function sourceTokens(source: SourceConfig): TokenEntry[] {
  return tokens[source.id]?.length ? tokens[source.id] : (source.api.known_india_tokens ?? []);
}

function tokenName(entry: TokenEntry): string {
  return typeof entry === "string" ? entry : (entry.token ?? "");
}

function companyFrom(entry: TokenEntry, token: string): string {
  if (typeof entry === "object" && entry.company) return entry.company;
  return token.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function entryUrl(entry: TokenEntry, template: string): string | null {
  if (typeof entry === "object") return entry.url ?? null;
  return template.replaceAll("{token}", entry).replaceAll("{company}", entry).replaceAll("{slug}", entry);
}

const gh: Extractor = (data, token) =>
  (data?.jobs ?? []).map((j: any) => ({
    sourceId: String(j.id), url: j.absolute_url, title: j.title,
    company: companyFrom(token, token), locationRaw: j.location?.name,
    description: j.content, postedAt: j.updated_at,
  }));

const lever: Extractor = (data, token) =>
  (Array.isArray(data) ? data : []).map((j: any) => ({
    sourceId: j.id, url: j.hostedUrl, title: j.text,
    company: companyFrom(token, token), locationRaw: j.categories?.location,
    description: j.descriptionPlain ?? j.description,
    postedAt: j.createdAt != null ? String(j.createdAt) : null,
  }));

const ashby: Extractor = (data, token) =>
  (data?.jobs ?? []).map((j: any) => ({
    sourceId: j.id, url: j.jobUrl, title: j.title,
    company: companyFrom(token, token), locationRaw: j.location,
    description: j.descriptionHtml ?? j.descriptionPlain, postedAt: j.publishedAt,
  }));

const smartrecruiters: Extractor = (data, token) =>
  (data?.content ?? []).map((j: any) => {
    const loc = j.location ?? {};
    let location = [loc.city, loc.region, loc.country].filter(Boolean).join(", ");
    if (loc.remote) location = (location + " (Remote)").trim();
    return {
      sourceId: String(j.id), url: j.applyUrl ?? j.ref, title: j.name,
      company: j.company?.name ?? companyFrom(token, token),
      locationRaw: location, description: null, postedAt: j.releasedDate,
    };
  });

const recruitee: Extractor = (data, token) =>
  (data?.offers ?? []).map((j: any) => ({
    sourceId: String(j.id), url: j.careers_url, title: j.title,
    company: companyFrom(token, token), locationRaw: j.location,
    description: j.description, postedAt: j.created_at,
  }));

function personioXml(text: string, token: string): ExtractedRow[] {
  const $ = cheerio.load(text, { xmlMode: true });
  const out: ExtractedRow[] = [];
  $("position").each((_, el) => {
    const pid = $(el).find("id").first().text();
    out.push({
      sourceId: pid, url: `https://${token}.jobs.personio.de/job/${pid}`,
      title: $(el).find("name").first().text(), company: companyFrom(token, token),
      locationRaw: $(el).find("office").first().text(),
      description: $(el).find("job-description").first().text(),
      postedAt: $(el).find("createdAt").first().text(),
    });
  });
  return out;
}

const teamtailor: Extractor = (data, token) => {
  const included = new Map<string, any>(
    (data?.included ?? []).filter((i: any) => i && typeof i === "object").map((i: any) => [i.id, i]),
  );
  return (data?.data ?? []).map((j: any) => {
    const attrs = j.attributes ?? {};
    const rel = j.relationships?.locations?.data ?? [];
    const locs = rel
      .map((r: any) => included.get(r.id)?.attributes?.name)
      .filter(Boolean);
    return {
      sourceId: String(j.id),
      url: j.links?.self ?? `https://${token}.teamtailor.com/jobs/${j.id}`,
      title: attrs.title, company: companyFrom(token, token),
      locationRaw: locs.join(", ") || attrs.location,
      description: attrs.body ?? attrs.pitch,
      postedAt: attrs["created-at"] ?? attrs["published-at"],
    };
  });
};

const workable: Extractor = (data, token) => {
  const jobs = Array.isArray(data) ? data : (data?.jobs ?? []);
  return jobs.map((j: any) => {
    const loc = j.location ?? {};
    const location = [loc.city, loc.country].filter(Boolean).join(", ");
    return {
      sourceId: String(j.id ?? j.shortcode),
      url: j.url ?? j.shortlink ?? `https://apply.workable.com/${token}/j/${j.shortcode}/`,
      title: j.title, company: companyFrom(token, token),
      locationRaw: location || j.location_str,
      description: j.description, postedAt: j.published_on ?? j.created_at,
    };
  });
};

const genericJson: Extractor = (data, token) => {
  let jobs: any[] | null = Array.isArray(data) ? data : null;
  if (jobs === null && data && typeof data === "object") {
    for (const key of ["jobs", "positions", "result", "data", "offers", "content", "items", "openings"]) {
      if (Array.isArray(data[key])) { jobs = data[key]; break; }
    }
  }
  const out: ExtractedRow[] = [];
  for (const j of jobs ?? []) {
    if (!j || typeof j !== "object") continue;
    let loc = j.location;
    if (loc && typeof loc === "object" && !Array.isArray(loc)) {
      loc = [loc.name, loc.city, loc.country].filter(Boolean).join(", ");
    } else if (Array.isArray(loc)) {
      loc = loc.join(", ");
    }
    let company = j.company ?? j.company_name ?? j.organization;
    if (company && typeof company === "object") company = company.name;
    out.push({
      sourceId: String(j.id ?? j.shortcode ?? ""),
      url: j.url ?? j.apply_url ?? j.jobUrl ?? j.careers_url ?? j.hostedUrl,
      title: j.title ?? j.name ?? j.jobOpeningName ?? j.position,
      company: company ?? companyFrom(token, token),
      locationRaw: loc || j.locationsText,
      description: j.description ?? j.descriptionHtml ?? j.body,
      postedAt: j.published_date ?? j.publishedAt ?? j.created_at ?? j.datePosted,
    });
  }
  return out;
};

const PLATFORMS: Record<string, { template: string; extract: Extractor; kind: "json" | "json_paginated" | "xml" }> = {
  greenhouse: { template: "https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true", extract: gh, kind: "json" },
  lever: { template: "https://api.lever.co/v0/postings/{token}?mode=json", extract: lever, kind: "json" },
  ashby: { template: "https://api.ashbyhq.com/posting-api/job-board/{token}", extract: ashby, kind: "json" },
  smartrecruiters: { template: "https://api.smartrecruiters.com/v1/companies/{token}/postings?limit=100&offset={offset}", extract: smartrecruiters, kind: "json_paginated" },
  recruitee: { template: "https://{token}.recruitee.com/api/offers/", extract: recruitee, kind: "json" },
  personio: { template: "https://{token}.jobs.personio.de/xml", extract: genericJson, kind: "xml" },
  teamtailor: { template: "https://{token}.teamtailor.com/jobs.json", extract: teamtailor, kind: "json" },
  workable: { template: "https://apply.workable.com/api/v1/widget/accounts/{token}?details=true", extract: workable, kind: "json" },
  polymer: { template: "https://api.polymer.co/v1/hire/organizations/{token}/jobs", extract: genericJson, kind: "json" },
};

export const CONFIGURED_URL_PLATFORMS = new Set([
  "breezy", "bamboohr", "pinpoint", "rippling_ats", "comeet", "jazzhr", "oracle_recruiting",
]);

function toRaw(sourceId: string, rows: ExtractedRow[]): RawJob[] {
  const out: RawJob[] = [];
  for (const r of rows) {
    if (!r.url || !r.title) continue;
    out.push({
      source: sourceId, sourceId: r.sourceId ?? null, url: r.url, title: r.title,
      company: r.company || "Unknown", locationRaw: r.locationRaw ?? null,
      description: r.description ?? null, postedAt: r.postedAt ?? null,
    });
  }
  return out;
}

export class AtsAdapter {
  constructor(protected source: SourceConfig) {}

  async fetch(client: QuotaClient, limit?: number): Promise<RawJob[]> {
    const platformId = (this.source.api.adapter as string) || this.source.id;
    const { template, extract, kind } = PLATFORMS[platformId];
    const out: RawJob[] = [];
    for (const entry of sourceTokens(this.source)) {
      const token = tokenName(entry);
      const url = entryUrl(entry, template);
      if (!url) continue;
      try {
        if (kind === "json_paginated") {
          let offset = 0;
          for (;;) {
            const data = await client.getJson(template.replaceAll("{token}", token).replaceAll("{offset}", String(offset)));
            if (!data) break;
            out.push(...toRaw(this.source.id, extract(data, token)));
            if ((data.content ?? []).length < 100) break;
            offset += 100;
          }
        } else if (kind === "xml") {
          const resp = await client.get(url, { useCache: true });
          if (resp === null) continue;
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          out.push(...toRaw(this.source.id, personioXml(await resp.text(), token)));
        } else {
          const data = await client.getJson(url, { useCache: true });
          if (data === null) continue;
          out.push(...toRaw(this.source.id, extract(data, token)));
        }
      } catch (e) {
        if (e instanceof QuotaExhausted) break;
        console.error(`[${this.source.id}] token ${token}:`, e);
        continue;
      }
      if (limit && out.length >= limit) break;
    }
    return limit ? out.slice(0, limit) : out;
  }
}

export class ConfiguredUrlAdapter {
  constructor(private source: SourceConfig) {}

  async fetch(client: QuotaClient, limit?: number): Promise<RawJob[]> {
    const entries = sourceTokens(this.source).filter(
      (e): e is { token?: string; company?: string; url: string } => typeof e === "object" && !!e.url,
    );
    if (!entries.length) {
      console.log(`[${this.source.id}] no verified URLs in ats_tokens.json — run scripts/probe_boards.ts first`);
      return [];
    }
    const out: RawJob[] = [];
    for (const entry of entries) {
      try {
        if (((this.source.api.adapter as string) || this.source.id) === "jazzhr") {
          const resp = await client.get(entry.url, { useCache: true });
          if (resp === null) continue;
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          out.push(...toRaw(this.source.id, personioXml(await resp.text(), entry.token ?? "")));
        } else {
          const data = await client.getJson(entry.url, { useCache: true });
          if (data === null) continue;
          out.push(...toRaw(this.source.id, genericJson(data, entry.token ?? "")));
        }
      } catch (e) {
        if (e instanceof QuotaExhausted) break;
        console.error(`[${this.source.id}] ${entry.url}:`, e);
      }
    }
    return limit ? out.slice(0, limit) : out;
  }
}

export class WorkdayAdapter {
  constructor(private source: SourceConfig) {}

  async fetch(client: QuotaClient, limit?: number): Promise<RawJob[]> {
    const entries = sourceTokens(this.source).filter(
      (e): e is { token?: string; company?: string; url: string } => typeof e === "object" && !!e.url,
    );
    if (!entries.length) {
      console.log("[workday_cxs] no verified tenant URLs in ats_tokens.json — run probe first");
      return [];
    }
    const out: RawJob[] = [];
    for (const entry of entries) {
      const base = entry.url.replace(/\/+$/, "");
      let offset = 0;
      try {
        for (;;) {
          const resp = await client.post(base, { json: { searchText: "", limit: 20, offset } });
          if (!resp || !resp.ok) throw new Error(`HTTP ${resp?.status}`);
          const data = await resp.json();
          const postings = data.jobPostings ?? [];
          for (const j of postings) {
            out.push({
              source: this.source.id,
              sourceId: j.bulletFields?.[0] ?? null,
              url: base.split("/wday/cxs")[0] + (j.externalPath ?? ""),
              title: j.title ?? "", company: entry.company ?? "Unknown",
              locationRaw: j.locationsText, description: null, postedAt: j.postedOn,
            });
          }
          offset += 20;
          if (offset >= Math.min(data.total ?? 0, 2000) || !postings.length) break;
        }
      } catch (e) {
        if (e instanceof QuotaExhausted) break;
        console.error(`[workday_cxs] ${base}:`, e);
      }
    }
    return limit ? out.slice(0, limit) : out;
  }
}

export function isAtsSource(id: string): boolean {
  return id in PLATFORMS || CONFIGURED_URL_PLATFORMS.has(id) || id === "workday_cxs";
}

export function makeAtsAdapter(source: SourceConfig) {
  const id = (source.api.adapter as string) || source.id;
  if (id === "workday_cxs") return new WorkdayAdapter(source);
  if (CONFIGURED_URL_PLATFORMS.has(id)) return new ConfiguredUrlAdapter(source);
  return new AtsAdapter(source);
}

// Arbitrary JSON job endpoint: fetches api.base_url and extracts with the
// generic field-mapping extractor (jobs/positions/data/items arrays).
export class GenericJsonAdapter {
  constructor(private source: SourceConfig) {}

  async fetch(client: QuotaClient, limit?: number): Promise<RawJob[]> {
    const data = await client.getJson(this.source.api.base_url);
    if (data === null) return [];
    const rows = toRaw(this.source.id, genericJson(data, ""));
    return limit ? rows.slice(0, limit) : rows;
  }
}