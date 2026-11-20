import type { QuotaClient } from "../http";
import { isBlockedUrl, type RawJob } from "../prefilter";
import { QuotaExhausted } from "../quota";
import type { SourceConfig } from "../registry";
import { asText, getPath } from "./custom_http";

// Adapters for licensed/partner job-data APIs: SerpApi, RapidAPI vendors,
// Fantastic.jobs (direct), JobsPipe, CleanJobData and Apify Actors. All use the
// standard SourceAdapter contract and declare their key names in api.auth.env
// so runner.withSecrets() injects vault values into process.env for fetch().

function firstText(row: any, paths: string[]): string | null {
  for (const path of paths) {
    const value = asText(getPath(row, path));
    if (value) return value;
  }
  return null;
}

function dayIndex(): number {
  const now = new Date();
  return Math.floor((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 0)) / 86400000);
}

function daysAgoIso(days: unknown, now = new Date()): string | null {
  const n = Number(days);
  if (!Number.isFinite(n) || n < 0) return null;
  return new Date(now.getTime() - n * 86400000).toISOString();
}

function rowsFrom(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const key of ["jobs", "data", "results", "items", "jobs_results", "postings"]) {
      const value = data[key];
      if (Array.isArray(value)) return value;
    }
  }
  return [];
}

function isBlocked(url: string | null): boolean {
  return !!url && isBlockedUrl(url);
}

function row(sourceId: string, fields: {
  sourceId?: string | null; url: string | null; title: string | null;
  company?: string | null; locationRaw?: string | null;
  description?: string | null; postedAt?: string | null; licensedFeed?: boolean;
}): RawJob | null {
  if (!fields.url || !fields.title) return null;
  return {
    source: sourceId,
    sourceId: fields.sourceId ?? null,
    url: fields.url,
    title: fields.title,
    company: fields.company || "Unknown",
    locationRaw: fields.locationRaw ?? null,
    description: fields.description ?? null,
    postedAt: fields.postedAt ?? null,
    ...(fields.licensedFeed ? { licensedFeed: true } : {}),
  };
}

function rapidHeaders(api: Record<string, any>): Record<string, string> {
  return {
    "X-RapidAPI-Key": process.env.RAPIDAPI_KEY!,
    "X-RapidAPI-Host": new URL(api.base_url).host,
  };
}

function finish(out: RawJob[], limit?: number): RawJob[] {
  return limit ? out.slice(0, limit) : out;
}

// ---------------------------------------------------------------------------
// SerpApi (google_jobs, indeed_jobs, glassdoor_jobs)
// ---------------------------------------------------------------------------

const SERP_QUERIES = [
  "fresher jobs in India",
  "internship in Bengaluru India",
  "internship in Mumbai India",
  "internship in Delhi India",
  "internship in Hyderabad India",
  "internship in Pune India",
  "graduate trainee jobs in India",
  "entry level software engineer jobs in India",
];
const SERP_LOCATIONS = ["India", "Bengaluru, India", "Mumbai, India", "Delhi, India", "Hyderabad, India", "Pune, India"];

function serpUrl(j: any): string | null {
  // Google Jobs results can expose a direct employer apply link; prefer one
  // that is not on the do-not-fetch list, then fall back to SerpApi's share
  // link. A blocklisted link is kept only with licensedFeed=true (link-back
  // only; never fetched by BeepRadar).
  const options = Array.isArray(j?.apply_options) ? j.apply_options : [];
  for (const option of options) {
    const url = asText(option?.link);
    if (url && !isBlocked(url)) return url;
  }
  return firstText(j, ["share_link", "apply_link", "link", "job_url", "url"]);
}

export function mapSerpJob(j: any, sourceId: string, now = new Date()): RawJob | null {
  if (!j || typeof j !== "object") return null;
  const posted =
    firstText(j, ["detected_extensions.posted_at", "posted_at", "date_posted"]) ??
    daysAgoIso(j.days_since_posted, now);
  return row(sourceId, {
    sourceId: firstText(j, ["job_id", "id"]),
    url: serpUrl(j),
    title: firstText(j, ["title", "job_title"]),
    company: firstText(j, ["company_name", "company", "employer_name"]),
    locationRaw: firstText(j, ["location", "job_location"]),
    description: firstText(j, ["description", "job_description"]),
    postedAt: posted,
    licensedFeed: true,
  });
}

export class SerpApiAdapter {
  constructor(private source: SourceConfig) {}

  async fetch(client: QuotaClient, limit?: number): Promise<RawJob[]> {
    const api = this.source.api as Record<string, any>;
    const engine = api.engine as string | undefined;
    if (!engine) throw new Error("SerpApi engine not configured");
    const queries: string[] = api.query_loop?.what?.length ? api.query_loop.what : SERP_QUERIES;
    const locations: string[] = api.query_loop?.where?.length ? api.query_loop.where : SERP_LOCATIONS;
    const i = dayIndex();
    const q = queries[i % queries.length];
    const location = locations[i % locations.length];
    const locationParam = engine === "indeed_jobs" ? "l" : "location";
    const out: RawJob[] = [];
    try {
      const resp = await client.get(api.base_url, {
        params: {
          ...(api.params_example as Record<string, string | number> | undefined),
          engine, q, [locationParam]: location, gl: "in", hl: "en",
          api_key: process.env.SERPAPI_KEY!,
        },
      });
      if (!resp || !resp.ok) throw new Error(`HTTP ${resp?.status}`);
      const data = await resp.json();
      if (data?.search_metadata?.status === "Error") throw new Error(String(data.error ?? "SerpApi error"));
      for (const j of data?.jobs_results ?? []) {
        const mapped = mapSerpJob(j, this.source.id);
        if (mapped) out.push(mapped);
      }
    } catch (e) {
      if (!(e instanceof QuotaExhausted)) throw e;
    }
    return finish(out, limit);
  }
}

// ---------------------------------------------------------------------------
// HireBase Jobs Data (RapidAPI)
// ---------------------------------------------------------------------------

export function mapHirebaseJob(j: any, sourceId: string): RawJob | null {
  if (!j || typeof j !== "object") return null;
  return row(sourceId, {
    sourceId: firstText(j, ["id", "job_id"]),
    url: firstText(j, ["url", "apply_url", "job_url", "external_url"]),
    title: firstText(j, ["title", "job_title"]),
    company: firstText(j, ["company.name", "company_name", "employer.name", "employer_name"]),
    locationRaw: firstText(j, ["location", "location_raw", "job_location"]),
    description: firstText(j, ["description", "job_description"]),
    postedAt: firstText(j, ["posted_at", "published_at", "date_posted", "created_at"]),
  });
}

export class HirebaseAdapter {
  constructor(private source: SourceConfig) {}

  async fetch(client: QuotaClient, limit?: number): Promise<RawJob[]> {
    const api = this.source.api as Record<string, any>;
    const body = {
      job_titles: ["intern", "internship", "fresher", "graduate trainee"],
      keywords: ["entry level", "new grad"],
      geo_locations: [{ country: "India" }],
      page: 1,
      limit: 25,
      ...(api.body as Record<string, unknown> | undefined),
    };
    const out: RawJob[] = [];
    try {
      const resp = await client.post(api.base_url, {
        headers: { "Content-Type": "application/json", ...rapidHeaders(api) },
        json: body,
      });
      if (!resp || !resp.ok) throw new Error(`HTTP ${resp?.status}`);
      const data = await resp.json();
      const root = api.response?.root ? getPath(data, api.response.root) : undefined;
      for (const j of (root ? rowsFrom(root) : rowsFrom(data?.jobs ?? data?.data ?? data))) {
        const mapped = mapHirebaseJob(j, this.source.id);
        if (mapped) out.push(mapped);
      }
    } catch (e) {
      if (!(e instanceof QuotaExhausted)) throw e;
    }
    return finish(out, limit);
  }
}

// ---------------------------------------------------------------------------
// LinkedIn Job Search API (Fantastic.jobs, RapidAPI) — licensed data feed only
// ---------------------------------------------------------------------------

export function mapLinkedInJob(j: any, sourceId: string): RawJob | null {
  if (!j || typeof j !== "object") return null;
  return row(sourceId, {
    sourceId: firstText(j, ["linkedin_id", "id", "job_id"]),
    url: firstText(j, ["job_url", "url", "apply_url", "linkedin_url", "link"]),
    title: firstText(j, ["title", "job_title"]),
    company: firstText(j, ["organization", "company", "company_name", "employer_name"]),
    locationRaw: firstText(j, ["location", "job_location", "location_raw"]),
    description: firstText(j, ["description", "job_description", "description_text"]),
    postedAt: firstText(j, ["posted_at", "posted_date", "date_posted", "created_at", "published_at"]),
    licensedFeed: true,
  });
}

export class LinkedInJobsAdapter {
  constructor(private source: SourceConfig) {}

  async fetch(client: QuotaClient, limit?: number): Promise<RawJob[]> {
    const api = this.source.api as Record<string, any>;
    const params = {
      time_frame: "24h",
      limit: 100,
      ...(api.params_example as Record<string, string | number> | undefined),
    };
    const out: RawJob[] = [];
    try {
      const resp = await client.get(api.base_url, { params, headers: rapidHeaders(api) });
      if (!resp || !resp.ok) throw new Error(`HTTP ${resp?.status}`);
      const data = await resp.json();
      const root = api.response?.root ? getPath(data, api.response.root) : undefined;
      for (const j of (root ? rowsFrom(root) : rowsFrom(data))) {
        const mapped = mapLinkedInJob(j, this.source.id);
        if (mapped) out.push(mapped);
      }
    } catch (e) {
      if (!(e instanceof QuotaExhausted)) throw e;
    }
    return finish(out, limit);
  }
}

// ---------------------------------------------------------------------------
// Fantastic.jobs direct API — licensed ATS + job-board data feed
// ---------------------------------------------------------------------------

const FANTASTIC_JOBS_ENDPOINTS = ["/v1/active-ats", "/v1/active-jb"];
const FANTASTIC_JOBS_VARIANTS: Record<string, string>[] = [
  { title: "intern", ai_employment_type: "INTERN" },
  { title: "fresher" },
  { title: "graduate trainee" },
  { title: "entry level" },
];

export function fantasticJobsSelection(api: Record<string, any> = {}, now = new Date()): {
  endpoint: string; variant: Record<string, string>;
} {
  const endpoints = Array.isArray(api.endpoints) && api.endpoints.length
    ? api.endpoints.map(String)
    : FANTASTIC_JOBS_ENDPOINTS;
  const variants = Array.isArray(api.query_variants) && api.query_variants.length
    ? api.query_variants.map((v: any) => ({ ...v }) as Record<string, string>)
    : FANTASTIC_JOBS_VARIANTS.map((v) => ({ ...v }));
  const hours = Math.max(1, Number(api.rotation_hours ?? 6) || 6);
  const slot = Math.floor(now.getTime() / (hours * 3600_000));
  return {
    endpoint: endpoints[slot % endpoints.length],
    variant: variants[Math.floor(slot / endpoints.length) % variants.length],
  };
}

function fantasticJobsLocation(j: any): string | null {
  const derived = Array.isArray(j?.locations_derived)
    ? j.locations_derived.filter((v: unknown) => typeof v === "string" && v.trim())
    : [];
  if (derived.length) return String(derived[0]);
  const alt = Array.isArray(j?.locations_alt)
    ? j.locations_alt.filter((v: unknown) => typeof v === "string" && v.trim())
    : [];
  if (alt.length) return String(alt[0]);
  const cities = Array.isArray(j?.cities_derived) ? j.cities_derived : [];
  const countries = Array.isArray(j?.countries_derived) ? j.countries_derived : [];
  return [cities[0], countries[0]].filter(Boolean).map(String).join(", ") || null;
}

export function mapFantasticJobsJob(j: any, sourceId: string): RawJob | null {
  if (!j || typeof j !== "object") return null;
  return row(sourceId, {
    sourceId: firstText(j, ["id"]),
    url: firstText(j, ["url", "job_url"]),
    title: firstText(j, ["title"]),
    company: firstText(j, ["organization", "org_linkedin_name"]),
    locationRaw: fantasticJobsLocation(j),
    description: firstText(j, ["description_text"]),
    postedAt: firstText(j, ["date_posted", "date_created"]),
    // Direct feed covers LinkedIn and career sites. URLs are attribution /
    // link-back only; BeepRadar never fetches the originating site.
    licensedFeed: true,
  });
}

export class FantasticJobsAdapter {
  constructor(private source: SourceConfig) {}

  async fetch(client: QuotaClient, limit?: number): Promise<RawJob[]> {
    const api = this.source.api as Record<string, any>;
    const { endpoint, variant } = fantasticJobsSelection(api);
    const params: Record<string, string | number> = {
      time_frame: "7d",
      limit: 10,
      description_format: "text",
      location: "India",
      ai_experience_level: "0-2",
      ...(api.params_example as Record<string, string | number> | undefined),
      ...variant,
    };
    // exclude_recruiter_fields is only documented on the job-board endpoint.
    if (endpoint.includes("active-jb")) params.exclude_recruiter_fields = "true";
    const url = `${String(api.base_url).replace(/\/$/, "")}${endpoint}`;
    const out: RawJob[] = [];
    try {
      const resp = await client.get(url, {
        params,
        headers: { Authorization: `Bearer ${process.env.FANTASTIC_JOBS_API_KEY!}` },
      });
      if (!resp || !resp.ok) throw new Error(`HTTP ${resp?.status ?? "no response"}`);
      const data = await resp.json();
      for (const j of rowsFrom(data)) {
        const mapped = mapFantasticJobsJob(j, this.source.id);
        if (mapped) out.push(mapped);
      }
    } catch (e) {
      if (!(e instanceof QuotaExhausted)) throw e;
    }
    return finish(out, limit);
  }
}

// ---------------------------------------------------------------------------
// JobsPipe (licensed aggregator of 30+ public ATS boards)
// ---------------------------------------------------------------------------

export function mapJobspipeJob(j: any, sourceId: string): RawJob | null {
  if (!j || typeof j !== "object") return null;
  const location = firstText(j, ["location", "short_location", "long_location"]);
  return row(sourceId, {
    sourceId: firstText(j, ["id"]),
    url: firstText(j, ["url", "source_url", "final_url", "job_url"]),
    title: firstText(j, ["job_title", "title"]),
    company: firstText(j, ["company", "company_name"]),
    locationRaw: location ? [location, firstText(j, ["country"])].filter(Boolean).join(", ") : null,
    description: firstText(j, ["description", "job_description", "description_plain"]),
    postedAt: firstText(j, ["posted_at", "date_posted"]),
  });
}

export class JobspipeAdapter {
  constructor(private source: SourceConfig) {}

  async fetch(client: QuotaClient, limit?: number): Promise<RawJob[]> {
    const api = this.source.api as Record<string, any>;
    const body = {
      job_title_or: ["intern", "internship", "fresher", "graduate trainee", "entry level"],
      job_country_code_or: ["IN"],
      posted_at_max_age_days: 30,
      status: "active",
      limit: 25,
      ...(api.body as Record<string, unknown> | undefined),
    };
    const out: RawJob[] = [];
    try {
      const resp = await client.post(api.base_url, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.JOBSPIPE_API_KEY!}`,
        },
        json: body,
      });
      if (!resp || !resp.ok) throw new Error(`HTTP ${resp?.status}`);
      const data = await resp.json();
      const root = api.response?.root ? getPath(data, api.response.root) : undefined;
      for (const j of (root ? rowsFrom(root) : rowsFrom(data?.data ?? data?.jobs ?? data))) {
        const mapped = mapJobspipeJob(j, this.source.id);
        if (mapped) out.push(mapped);
      }
    } catch (e) {
      if (!(e instanceof QuotaExhausted)) throw e;
    }
    return finish(out, limit);
  }
}

// ---------------------------------------------------------------------------
// Apify Actors (config-driven; actor ID + input come from the source config)
// ---------------------------------------------------------------------------

function apifyPaths(config: Record<string, any> | undefined, key: string, fallback: string[]): string[] {
  const configured = config?.field_map?.[key];
  if (!configured) return fallback;
  return Array.isArray(configured) ? configured.map(String) : [String(configured)];
}

export function mapApifyItem(j: any, sourceId: string, api: Record<string, any> = {}): RawJob | null {
  if (!j || typeof j !== "object") return null;
  const pick = (key: string, fallback: string[]) => firstText(j, apifyPaths(api, key, fallback));
  return row(sourceId, {
    sourceId: pick("sourceId", ["id", "jobId", "job_id", "listingId"]),
    url: pick("url", ["url", "jobUrl", "job_url", "jdURL", "link", "applyUrl", "apply_url"]),
    title: pick("title", ["title", "job_title", "jobTitle", "position"]),
    company: pick("company", ["company", "companyName", "company_name", "employer", "organization"]),
    locationRaw: pick("location", ["location", "locationRaw", "job_location", "city"]),
    description: pick("description", ["description", "jobDescription", "job_description"]),
    postedAt: pick("postedAt", ["postedAt", "posted_at", "datePosted", "date_posted", "createdDate", "postedText", "postedAtRelative"]),
    // Approved paid third-party feeds: result URLs are attribution/link-back
    // only. BeepRadar never fetches the originating site itself.
    licensedFeed: api.licensedFeed !== false,
  });
}

export class ApifyActorAdapter {
  constructor(private source: SourceConfig) {}

  async fetch(client: QuotaClient, limit?: number): Promise<RawJob[]> {
    const api = this.source.api as Record<string, any>;
    const actorId = firstText(api, ["actor_id"]);
    if (!actorId || !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)?$/.test(actorId))
      throw new Error("Apify actor_id is not configured for this source");
    const url = `${api.base_url.replace(/\/$/, "")}/${actorId}/run-sync-get-dataset-items`;
    const input: Record<string, unknown> = { ...(api.input ?? {}) };
    for (const [key, values] of Object.entries(api.input_loop ?? {})) {
      if (Array.isArray(values) && values.length) {
        input[key] = values[dayIndex() % values.length];
      }
    }
    const out: RawJob[] = [];
    try {
      const resp = await client.post(url, {
        // Apify's synchronous run endpoint can take minutes; the client
        // default is 15s, so give this call the full 300s actor timeout.
        timeoutMs: 300_000,
        params: { timeout: 300 },
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.APIFY_TOKEN!}`,
        },
        json: input,
      });
      if (!resp || !resp.ok) throw new Error(`HTTP ${resp?.status}`);
      const data = await resp.json();
      for (const j of rowsFrom(data)) {
        const mapped = mapApifyItem(j, this.source.id, api);
        if (mapped) out.push(mapped);
      }
    } catch (e) {
      if (!(e instanceof QuotaExhausted)) throw e;
    }
    return finish(out, limit);
  }
}

// ---------------------------------------------------------------------------
// CleanJobData (official partner API)
// ---------------------------------------------------------------------------

const CLEANJOBDATA_VARIANTS: Record<string, string | number>[] = [
  { title: "fresher", experience_level: "EN" },
  { title: "intern", employment_type: "INTERN" },
  { title: "graduate", experience_level: "EN" },
  { title: "entry level", experience_level: "EN" },
];

function cleanJobDataLocation(j: any): string | null {
  const direct = firstText(j, ["location"]);
  if (direct) return direct;
  const locations = Array.isArray(j?.locations) ? j.locations : [];
  const primary = locations.find((l: any) => l?.is_primary) ?? locations[0];
  if (!primary) return null;
  const label = firstText(primary, ["display_label"]);
  if (label) return label;
  const parts = ["city_name", "state_name", "country_name"]
    .map((k) => firstText(primary, [k]))
    .filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export function mapCleanJobDataItem(j: any, sourceId: string): RawJob | null {
  if (!j || typeof j !== "object") return null;
  return row(sourceId, {
    sourceId: firstText(j, ["id"]),
    url: firstText(j, ["application_url"]),
    title: firstText(j, ["title"]),
    company: firstText(j, ["company.name"]),
    locationRaw: cleanJobDataLocation(j),
    description: firstText(j, ["description"]),
    postedAt: firstText(j, ["published"]),
    // Trial application_url is a CleanJobData redirect. Keep it for
    // attribution/link-back; BeepRadar never fetches the destination.
    licensedFeed: true,
  });
}

export class CleanJobDataAdapter {
  constructor(private source: SourceConfig) {}

  async fetch(client: QuotaClient, limit?: number): Promise<RawJob[]> {
    const api = this.source.api as Record<string, any>;
    const variants = Array.isArray(api.query_variants) && api.query_variants.length
      ? api.query_variants
      : CLEANJOBDATA_VARIANTS;
    const baseParams: Record<string, string | number> = {
      location: "IN",
      max_age: "30d",
      limit: 20,
      extra_fields: "description",
      ...(api.query ?? {}),
    };
    const pages = Math.max(1, Math.min(Number(api.pages_per_variant ?? 1) || 1, 5));
    const out: RawJob[] = [];

    for (const variant of variants) {
      const params: Record<string, string | number> = { ...baseParams, ...variant };
      let cursor: string | null = null;
      for (let page = 0; page < pages; page++) {
        if (cursor) params.cursor = cursor;
        else delete params.cursor;
        const resp = await client.get(api.base_url, {
          params,
          headers: { Authorization: `Bearer ${process.env.CLEANJOBDATA_API_KEY!}` },
        });
        if (!resp || !resp.ok) throw new Error(`HTTP ${resp?.status ?? "no response"}`);
        const data = await resp.json();
        for (const j of rowsFrom(data)) {
          const mapped = mapCleanJobDataItem(j, this.source.id);
          if (mapped) out.push(mapped);
        }
        const next = getPath(data, "pagination.next_page");
        cursor = typeof next === "string" && next ? next : null;
        if (!cursor) break;
        if (limit && out.length >= limit) break;
      }
      if (limit && out.length >= limit) break;
    }
    return finish(out, limit);
  }
}

const ADAPTERS: Record<string, new (s: SourceConfig) => {
  fetch(client: QuotaClient, limit?: number): Promise<RawJob[]>;
}> = {
  cleanjobdata: CleanJobDataAdapter,
  fantastic_jobs: FantasticJobsAdapter,
  serpapi_jobs: SerpApiAdapter,
  serpapi_google_jobs: SerpApiAdapter,
  serpapi_indeed_jobs: SerpApiAdapter,
  serpapi_glassdoor_jobs: SerpApiAdapter,
  rapidapi_hirebase: HirebaseAdapter,
  rapidapi_linkedin_jobs: LinkedInJobsAdapter,
  jobspipe: JobspipeAdapter,
  apify_actor: ApifyActorAdapter,
};

export function isLicensedApiSource(id: string): boolean {
  return id in ADAPTERS;
}

export function makeLicensedApiAdapter(source: SourceConfig) {
  const id = (source.api.adapter as string) || source.id;
  return new ADAPTERS[id](source);
}
