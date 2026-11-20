import type { QuotaClient } from "../http";
import type { RawJob } from "../prefilter";
import { QuotaExhausted } from "../quota";
import type { SourceConfig } from "../registry";

// Config-driven adapter for arbitrary JSON job APIs added from the admin portal.
// api: { base_url, method, headers, query, body, auth: {in, name, secret},
//        response: { root, fields: {title,url,company,location,description,posted_at,id},
//                    pagination: {type: none|page|offset, param, start, step, max_pages} } }

export function getPath(obj: unknown, path: string | undefined): unknown {
  if (!path) return undefined;
  let cur: any = obj;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return cur;
}

export function asText(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(", ") || null;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return asText(o.name ?? o.city ?? o.title ?? o.text) ?? JSON.stringify(v).slice(0, 200);
  }
  return null;
}

const ARRAY_KEYS = ["jobs", "positions", "results", "data", "offers", "content", "items", "openings", "postings", "records"];

export function autoRoot(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const k of ARRAY_KEYS) {
      const v = (data as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v;
      if (v && typeof v === "object") {
        const nested = autoRoot(v);
        if (nested.length) return nested;
      }
    }
  }
  return [];
}

export interface RootSuggestion { path: string; count: number; sample_keys: string[] }

export function suggestRoots(data: unknown, prefix = "", depth = 0, out: RootSuggestion[] = []): RootSuggestion[] {
  if (depth > 3 || out.length >= 8 || data == null || typeof data !== "object") return out;
  if (Array.isArray(data)) {
    const objs = data.filter((x) => x && typeof x === "object" && !Array.isArray(x));
    if (objs.length) {
      out.push({
        path: prefix || "(root)",
        count: data.length,
        sample_keys: Object.keys(objs[0] as object).slice(0, 12),
      });
    }
    return out;
  }
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    suggestRoots(v, prefix ? `${prefix}.${k}` : k, depth + 1, out);
  }
  return out;
}

export interface FieldMap {
  title: string; url: string; company?: string; location?: string;
  description?: string; posted_at?: string; id?: string;
}

export function mapRow(item: unknown, fields: FieldMap, sourceId: string): RawJob | null {
  const url = asText(getPath(item, fields.url));
  const title = asText(getPath(item, fields.title));
  if (!url || !title) return null;
  return {
    source: sourceId,
    sourceId: asText(getPath(item, fields.id)),
    url, title,
    company: asText(getPath(item, fields.company)) || "Unknown",
    locationRaw: asText(getPath(item, fields.location)),
    description: asText(getPath(item, fields.description)),
    postedAt: asText(getPath(item, fields.posted_at)),
  };
}

export function buildHttpRequest(api: Record<string, any>, secretValue?: string): {
  method: string; headers: Record<string, string>; params: Record<string, string | number>; json?: unknown;
} {
  const headers: Record<string, string> = { ...(api.headers ?? {}) };
  const params: Record<string, string | number> = { ...(api.query ?? {}) };
  const auth = api.auth ?? {};
  if (secretValue && auth.in && auth.in !== "none") {
    if (auth.in === "header") headers[auth.name] = secretValue;
    else if (auth.in === "bearer") headers["Authorization"] = `Bearer ${secretValue}`;
    else if (auth.in === "basic") headers["Authorization"] = `Basic ${Buffer.from(secretValue).toString("base64")}`;
    else if (auth.in === "query") params[auth.name] = secretValue;
  }
  const method = api.method === "POST" ? "POST" : "GET";
  return { method, headers, params, ...(method === "POST" ? { json: api.body ?? {} } : {}) };
}

export class CustomHttpAdapter {
  constructor(private source: SourceConfig) {}

  async fetch(client: QuotaClient, limit?: number): Promise<RawJob[]> {
    const api = this.source.api as Record<string, any>;
    const response = api.response ?? {};
    const fields: FieldMap = response.fields ?? { title: "title", url: "url" };
    const secretName = api.auth?.secret ?? api.auth?.env?.[0];
    const secretValue = secretName ? process.env[secretName] : undefined;
    const { method, headers, params, json } = buildHttpRequest(api, secretValue);

    const pag = response.pagination ?? { type: "none" };
    const maxPages = Math.min(Math.max(pag.max_pages ?? 1, 1), 10);
    const step = pag.step ?? 100;
    const out: RawJob[] = [];
    try {
      for (let page = 0; page < maxPages; page++) {
        const p = { ...params };
        if (pag.type === "page") p[pag.param ?? "page"] = (pag.start ?? 1) + page;
        if (pag.type === "offset") p[pag.param ?? "offset"] = page * step;
        const resp = await client.request(method, api.base_url, { params: p, headers, json });
        if (resp === null) break;
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const root = response.root ? getPath(data, response.root) : autoRoot(data);
        const items = Array.isArray(root) ? root : [];
        for (const item of items) {
          const row = mapRow(item, fields, this.source.id);
          if (row) out.push(row);
        }
        if (pag.type === "none" || items.length === 0) break;
        if (pag.type === "offset" && items.length < step) break;
        if (limit && out.length >= limit) break;
      }
    } catch (e) {
      if (!(e instanceof QuotaExhausted)) throw e;
    }
    return limit ? out.slice(0, limit) : out;
  }
}