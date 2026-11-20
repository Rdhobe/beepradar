import type { QuotaClient } from "../http";
import type { RawJob } from "../prefilter";
import { QuotaExhausted } from "../quota";
import type { SourceConfig } from "../registry";

function push(sid: string, out: RawJob[], r: {
  sourceId?: string | null; url?: string | null; title?: string | null; company?: string | null;
  locationRaw?: string | null; description?: string | null; postedAt?: string | null;
}) {
  if (!r.url || !r.title) return;
  out.push({
    source: sid, sourceId: r.sourceId ?? null, url: r.url, title: r.title,
    company: r.company || "Unknown", locationRaw: r.locationRaw ?? null,
    description: r.description ?? null, postedAt: r.postedAt ?? null,
  });
}

const CITIES6 = ["Bangalore", "Mumbai", "Delhi", "Hyderabad", "Pune", "Chennai"];
const KEYWORDS3 = ["intern", "fresher", "graduate trainee"];

export class AdzunaAdapter {
  constructor(private source: SourceConfig) {}

  async fetch(client: QuotaClient, limit?: number): Promise<RawJob[]> {
    const loop = this.source.api.query_loop ?? { what: ["intern"], where: ["bangalore"], pages: 2 };
    const out: RawJob[] = [];
    try {
      outer:
      for (const what of loop.what) {
        for (const where of loop.where) {
          for (let page = 1; page <= loop.pages; page++) {
            const url = this.source.api.base_url.replace("{page}", String(page));
            const resp = await client.get(url, {
              params: {
                app_id: process.env.ADZUNA_APP_ID!, app_key: process.env.ADZUNA_APP_KEY!,
                results_per_page: 50, what, where, sort_by: "date", max_days_old: 14,
              },
            });
            if (!resp || !resp.ok) throw new Error(`HTTP ${resp?.status}`);
            const results = (await resp.json()).results ?? [];
            for (const j of results) {
              push(this.source.id, out, {
                sourceId: String(j.id), url: j.redirect_url, title: j.title,
                company: j.company?.display_name, locationRaw: j.location?.display_name,
                description: j.description, postedAt: j.created,
              });
            }
            if (!results.length) break;
            if (limit && out.length >= limit) break outer;
          }
        }
      }
    } catch (e) {
      if (!(e instanceof QuotaExhausted)) console.error(`[${this.source.id}]`, e);
    }
    return limit ? out.slice(0, limit) : out;
  }
}

export class JoobleAdapter {
  constructor(private source: SourceConfig) {}

  async fetch(client: QuotaClient, limit?: number): Promise<RawJob[]> {
    const url = this.source.api.base_url.replace("{api_key}", process.env.JOOBLE_API_KEY!);
    const out: RawJob[] = [];
    try {
      outer:
      for (const keywords of KEYWORDS3) {
        for (const location of CITIES6) {
          for (const page of [1, 2]) {
            const resp = await client.post(url, { json: { keywords, location, page } });
            if (!resp || !resp.ok) throw new Error(`HTTP ${resp?.status}`);
            const jobs = (await resp.json()).jobs ?? [];
            for (const j of jobs) {
              push(this.source.id, out, {
                sourceId: String(j.id), url: j.link, title: j.title, company: j.company,
                locationRaw: j.location, description: j.snippet, postedAt: j.updated,
              });
            }
            if (!jobs.length) break;
            if (limit && out.length >= limit) break outer;
          }
        }
      }
    } catch (e) {
      if (!(e instanceof QuotaExhausted)) console.error(`[${this.source.id}]`, e);
    }
    return limit ? out.slice(0, limit) : out;
  }
}

export class CareerjetAdapter {
  constructor(private source: SourceConfig) {}

  async fetch(client: QuotaClient, limit?: number): Promise<RawJob[]> {
    const out: RawJob[] = [];
    try {
      outer:
      for (const keywords of KEYWORDS3) {
        for (const location of CITIES6) {
          const resp = await client.get(this.source.api.base_url, {
            params: {
              ...(this.source.api.params_example as Record<string, string | number> ?? {}),
              keywords, location, affid: process.env.CAREERJET_API_KEY!, page: 1,
            },
          });
          if (!resp || !resp.ok) throw new Error(`HTTP ${resp?.status}`);
          for (const j of (await resp.json()).jobs ?? []) {
            push(this.source.id, out, {
              sourceId: String(j.id), url: j.url, title: j.title, company: j.company,
              locationRaw: j.locations, description: j.description, postedAt: j.date,
            });
          }
          if (limit && out.length >= limit) break outer;
        }
      }
    } catch (e) {
      if (!(e instanceof QuotaExhausted)) console.error(`[${this.source.id}]`, e);
    }
    return limit ? out.slice(0, limit) : out;
  }
}

const JSEARCH_QUERIES = [
  "fresher jobs in India",
  "internship in Bengaluru India",
  "internship in Mumbai India",
  "internship in Delhi NCR India",
  "internship in Hyderabad India",
  "internship in Pune India",
  "internship in Chennai India",
  "graduate trainee jobs in India",
  "entry level software engineer jobs in India",
  "data analyst intern jobs in India",
];

export class JSearchAdapter {
  constructor(private source: SourceConfig) {}

  async fetch(client: QuotaClient): Promise<RawJob[]> {
    const now = new Date();
    const day = Math.floor((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 0)) / 86400000);
    const query = JSEARCH_QUERIES[day % JSEARCH_QUERIES.length];
    const resp = await client.get(this.source.api.base_url, {
      params: { query, page: 1, num_pages: 1, gl: "in" },
      headers: {
        "X-RapidAPI-Key": process.env.RAPIDAPI_KEY!,
        "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
      },
    });
    if (!resp || !resp.ok) throw new Error(`HTTP ${resp?.status}`);
    const out: RawJob[] = [];
    for (const j of (await resp.json()).data ?? []) {
      const location = [j.job_city, j.job_state, j.job_country].filter(Boolean).join(", ");
      push(this.source.id, out, {
        sourceId: j.job_id, url: j.job_apply_link, title: j.job_title, company: j.employer_name,
        locationRaw: location, description: j.job_description, postedAt: j.job_posted_at_datetime_utc,
      });
    }
    return out;
  }
}

export class ActiveJobsDbAdapter {
  constructor(private source: SourceConfig) {}

  async fetch(client: QuotaClient): Promise<RawJob[]> {
    const resp = await client.get(this.source.api.base_url, {
      params: { ...(this.source.api.params_example as Record<string, string | number> ?? {}), limit: 100 },
      headers: {
        "X-RapidAPI-Key": process.env.RAPIDAPI_KEY!,
        "X-RapidAPI-Host": "active-jobs-db.p.rapidapi.com",
      },
    });
    if (!resp || !resp.ok) throw new Error(`HTTP ${resp?.status}`);
    const data = await resp.json();
    let jobs: any[] | null = Array.isArray(data) ? data : null;
    if (jobs === null && data && typeof data === "object") {
      for (const key of ["jobs", "data", "results", "items"]) {
        if (Array.isArray(data[key])) { jobs = data[key]; break; }
      }
    }
    const out: RawJob[] = [];
    for (const j of jobs ?? []) {
      if (!j || typeof j !== "object") continue;
      let loc = j.location ?? j.locations;
      if (Array.isArray(loc)) loc = loc.join(", ");
      push(this.source.id, out, {
        sourceId: String(j.id), url: j.url ?? j.apply_url ?? j.job_url,
        title: j.title ?? j.job_title, company: j.company ?? j.company_name ?? j.organization,
        locationRaw: loc, description: j.description, postedAt: j.posted_at ?? j.date_posted,
      });
    }
    return out;
  }
}

const AGGREGATORS: Record<string, new (s: SourceConfig) => { fetch(client: QuotaClient, limit?: number): Promise<RawJob[]> }> = {
  adzuna_in: AdzunaAdapter,
  jooble_in: JoobleAdapter,
  careerjet_in: CareerjetAdapter,
  jsearch: JSearchAdapter,
  active_jobs_db: ActiveJobsDbAdapter,
};

export function isAggregatorSource(id: string): boolean {
  return id in AGGREGATORS;
}

export function makeAggregatorAdapter(source: SourceConfig) {
  return new AGGREGATORS[(source.api.adapter as string) || source.id](source);
}