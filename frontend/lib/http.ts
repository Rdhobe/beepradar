import { sql } from "./db/client";
import { QuotaExhausted, QuotaTracker, RateLimited } from "./quota";
import { USER_AGENT, type SourceConfig } from "./registry";
import { redactSecrets } from "./secrets";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class QuotaClient {
  private tracker: QuotaTracker;
  private delayMs: number;
  private timeoutMs: number;
  private lastRequest = new Map<string, number>();
  private redactValues: string[];

  constructor(source: SourceConfig, tracker: QuotaTracker, redactValues: string[] = []) {
    this.tracker = tracker;
    this.delayMs = (source.schedule.request_delay_s ?? 3) * 1000;
    this.timeoutMs = 15000;
    this.redactValues = redactValues;
  }

  private async waitForHost(url: string) {
    const host = new URL(url).host;
    const last = this.lastRequest.get(host) ?? 0;
    const wait = this.delayMs - (Date.now() - last);
    if (wait > 0) await sleep(wait);
    this.lastRequest.set(host, Date.now());
  }

  async request(
    method: string,
    url: string,
    opts: { useCache?: boolean; params?: Record<string, string | number>; json?: unknown; headers?: Record<string, string>; timeoutMs?: number } = {},
  ): Promise<Response | null> {
    if (!(await this.tracker.canRequest())) {
      throw new QuotaExhausted(`${this.tracker.sourceId}: quota or run budget exhausted`);
    }
    let target = url;
    if (opts.params) {
      const u = new URL(url);
      for (const [k, v] of Object.entries(opts.params)) u.searchParams.set(k, String(v));
      target = u.toString();
    }
    const headers: Record<string, string> = {
      "User-Agent": USER_AGENT,
      Accept: "application/json, text/xml, application/xml, */*",
      ...(opts.json != null ? { "Content-Type": "application/json" } : {}),
      ...opts.headers,
    };
    if (opts.useCache) {
      const rows = await sql`SELECT etag, last_modified FROM http_cache WHERE url = ${url}`;
      if (rows[0]?.etag) headers["If-None-Match"] = rows[0].etag;
      if (rows[0]?.last_modified) headers["If-Modified-Since"] = rows[0].last_modified;
    }
    await this.waitForHost(target);
    await this.tracker.recordRequest();
    const resp = await fetch(target, {
      method,
      headers,
      body: opts.json != null ? JSON.stringify(opts.json) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? this.timeoutMs),
      redirect: "follow",
    });
    if (resp.status === 429) {
      const ra = resp.headers.get("Retry-After");
      const seconds = ra ? (isNaN(Number(ra)) ? 3600 : Number(ra)) : null;
      throw new RateLimited(seconds);
    }
    if (opts.useCache) {
      if (resp.status === 304) return null;
      if (resp.status === 200) {
        await sql`
          INSERT INTO http_cache (url, etag, last_modified, fetched_at)
          VALUES (${url}, ${resp.headers.get("ETag")}, ${resp.headers.get("Last-Modified")}, now())
          ON CONFLICT (url) DO UPDATE SET
            etag = EXCLUDED.etag, last_modified = EXCLUDED.last_modified, fetched_at = now()`;
      }
    }
    return resp;
  }

  async get(url: string, opts: Parameters<QuotaClient["request"]>[2] = {}): Promise<Response | null> {
    return this.request("GET", url, opts);
  }

  async post(url: string, opts: Parameters<QuotaClient["request"]>[2] = {}): Promise<Response | null> {
    return this.request("POST", url, opts);
  }

  async getJson<T = any>(url: string, opts: Parameters<QuotaClient["request"]>[2] = {}): Promise<T | null> {
    const resp = await this.get(url, opts);
    if (resp === null) return null;
    if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${redactSecrets(url, this.redactValues)}`);
    return (await resp.json()) as T;
  }
}