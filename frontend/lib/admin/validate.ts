import parser from "cron-parser";
import { isBlockedUrl } from "@/lib/prefilter";
import { mergePatch, registry, type Quota, type SourceConfig } from "@/lib/registry";

export const ADAPTER_KIND: Record<string, "tokens" | "urls" | "rss" | "pages" | "base_url" | "custom"> = {
  greenhouse: "tokens", lever: "tokens", ashby: "tokens", smartrecruiters: "tokens",
  recruitee: "tokens", personio: "tokens", teamtailor: "tokens", workable: "tokens", polymer: "tokens",
  breezy: "urls", bamboohr: "urls", pinpoint: "urls", rippling_ats: "urls",
  comeet: "urls", jazzhr: "urls", oracle_recruiting: "urls", workday_cxs: "urls",
  weworkremotely_rss: "rss",
  jsonld_careers: "pages",
  generic_json: "base_url",
  custom_http: "custom",
};

export const ALLOWED_ADAPTERS = Object.keys(ADAPTER_KIND);

const WINDOWS = ["minute", "hour", "day", "week", "month"];

export function validateQuotas(quotas: unknown): { quotas?: Quota[]; error?: string } {
  if (!Array.isArray(quotas) || quotas.length === 0) return { error: "at least one quota limit is required" };
  if (quotas.length > 6) return { error: "too many quota rows (max 6)" };
  const out: Quota[] = [];
  for (const q of quotas) {
    if (!q || typeof q !== "object") return { error: "invalid quota row" };
    const { n, per, hard } = q as Record<string, unknown>;
    if (typeof n !== "number" || !Number.isInteger(n) || n <= 0 || n > 1_000_000) {
      return { error: "quota n must be a positive integer" };
    }
    if (typeof per !== "string" || !WINDOWS.includes(per)) {
      return { error: `quota per must be one of ${WINDOWS.join("/")}` };
    }
    out.push({ n, per, ...(hard === true ? { hard: true } : {}) });
  }
  return { quotas: out };
}

export function validateCron(cron: unknown): string | null {
  if (typeof cron !== "string" || !cron.trim()) return "cron expression is required";
  try {
    parser.parseExpression(cron.trim(), { tz: "UTC" });
    return null;
  } catch {
    return `invalid cron expression: ${cron}`;
  }
}

function checkUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return `invalid URL: ${url}`;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return `URL must be http(s): ${url}`;
  if (isBlockedUrl(url)) return `blocklisted site — never fetch: ${url}`;
  return null;
}

// Lines: "slug" or "slug|Company Name" (tokens), "url|Company Name" (urls),
// plain URLs (rss/pages/base_url).
export function parseTokenLines(text: unknown, kind: string): { api?: Record<string, unknown>; error?: string } {
  const lines = String(text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { error: "at least one token / URL line is required" };
  if (lines.length > 50) return { error: "too many lines (max 50)" };

  if (kind === "tokens") {
    const entries = lines.map((l) => {
      const [token, company] = l.split("|").map((p) => p.trim());
      return company ? { token, company } : token;
    });
    for (const e of entries) {
      const t = typeof e === "string" ? e : e.token;
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(t)) return { error: `invalid board token: ${t}` };
    }
    return { api: { known_india_tokens: entries } };
  }
  if (kind === "urls") {
    const entries = [];
    for (const l of lines) {
      const [url, company] = l.split("|").map((p) => p.trim());
      const err = checkUrl(url);
      if (err) return { error: err };
      entries.push({ url, ...(company ? { company } : {}) });
    }
    return { api: { known_india_tokens: entries } };
  }
  if (kind === "rss" || kind === "pages") {
    for (const l of lines) {
      const err = checkUrl(l);
      if (err) return { error: err };
    }
    const key = kind === "rss" ? "feeds" : "pages";
    return { api: { [key]: lines.slice(0, kind === "rss" ? 3 : 50) } };
  }
  if (kind === "base_url") {
    if (lines.length !== 1) return { error: "generic_json takes exactly one URL" };
    const err = checkUrl(lines[0]);
    if (err) return { error: err };
    return { api: { base_url: lines[0] } };
  }
  return { error: `unknown adapter kind: ${kind}` };
}

interface ScheduleInput {
  cron?: unknown; max_requests_per_run?: unknown;
  daily_budget?: unknown; monthly_budget?: unknown; request_delay_s?: unknown;
}

function validateSchedule(s: ScheduleInput, requireCron: boolean): { schedule?: Record<string, unknown>; error?: string } {
  const out: Record<string, unknown> = {};
  if (s.cron !== undefined || requireCron) {
    const err = validateCron(s.cron);
    if (err) return { error: err };
    out.cron = (s.cron as string).trim();
  }
  if (s.max_requests_per_run !== undefined) {
    const n = s.max_requests_per_run;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 200) {
      return { error: "max_requests_per_run must be an integer 0–200" };
    }
    out.max_requests_per_run = n;
  }
  for (const k of ["daily_budget", "monthly_budget"] as const) {
    if (s[k] !== undefined && s[k] !== null) {
      const n = s[k];
      if (typeof n !== "number" || !Number.isInteger(n) || n <= 0 || n > 1_000_000) {
        return { error: `${k} must be a positive integer` };
      }
      out[k] = n;
    }
  }
  if (s.request_delay_s !== undefined) {
    const n = s.request_delay_s;
    if (typeof n !== "number" || n < 0 || n > 60) return { error: "request_delay_s must be 0–60" };
    out.request_delay_s = n;
  }
  return { schedule: out };
}

export interface CreateInput {
  id?: unknown; name?: unknown; adapter?: unknown; group?: unknown; priority?: unknown;
  cron?: unknown; max_requests_per_run?: unknown; daily_budget?: unknown;
  monthly_budget?: unknown; request_delay_s?: unknown; quotas?: unknown;
  token_lines?: unknown; notes?: unknown; http?: unknown;
}

const AUTH_IN = ["none", "header", "query", "bearer", "basic"];
const PAG_TYPES = ["none", "page", "offset"];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

// Validates the full Custom HTTP API config (URL, auth, mapping, pagination).
export function buildHttpApi(input: unknown): { api?: Record<string, unknown>; error?: string } {
  if (!isPlainObject(input)) return { error: "http config is required for custom_http" };
  const url = String(input.url ?? "").trim();
  const urlErr = checkUrl(url);
  if (urlErr) return { error: urlErr };
  const method = input.method === "POST" ? "POST" : "GET";

  const authIn = input.auth_in === undefined ? "none" : String(input.auth_in);
  if (!AUTH_IN.includes(authIn)) return { error: `auth_in must be one of ${AUTH_IN.join("/")}` };
  const authName = String(input.auth_name ?? "").trim();
  const secret = String(input.secret ?? "").trim();
  if (authIn !== "none") {
    if (authIn !== "bearer" && authIn !== "basic" && !authName) return { error: "auth_name is required (header or query param name)" };
    if (!/^[A-Z][A-Z0-9_]{1,60}$/.test(secret)) return { error: "secret must be a KEY_NAME like RAPIDAPI_KEY (uppercase, underscores)" };
  }

  for (const k of ["headers", "query", "body"] as const) {
    if (input[k] !== undefined && input[k] !== null && !isPlainObject(input[k])) {
      return { error: `${k} must be a JSON object` };
    }
  }

  const response = input.response;
  if (!isPlainObject(response)) return { error: "response mapping is required" };
  const fields = response.fields;
  if (!isPlainObject(fields)) return { error: "response.fields is required" };
  const fTitle = String(fields.title ?? "").trim();
  const fUrl = String(fields.url ?? "").trim();
  if (!fTitle || !fUrl) return { error: "response.fields.title and response.fields.url are required" };
  const cleanFields: Record<string, string> = { title: fTitle, url: fUrl };
  for (const k of ["company", "location", "description", "posted_at", "id"] as const) {
    const v = String(fields[k] ?? "").trim();
    if (v) cleanFields[k] = v;
  }
  const root = String(response.root ?? "").trim();

  const pag = isPlainObject(response.pagination) ? response.pagination : { type: "none" };
  const pagType = String(pag.type ?? "none");
  if (!PAG_TYPES.includes(pagType)) return { error: `pagination.type must be one of ${PAG_TYPES.join("/")}` };
  const pagination: Record<string, unknown> = { type: pagType };
  if (pagType !== "none") {
    pagination.param = String(pag.param ?? (pagType === "page" ? "page" : "offset")).trim() || "page";
    const maxPages = Number(pag.max_pages ?? 1);
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 10) return { error: "pagination.max_pages must be 1–10" };
    pagination.max_pages = maxPages;
    if (pagType === "page") pagination.start = Number.isInteger(Number(pag.start)) ? Number(pag.start) : 1;
    if (pagType === "offset") {
      const step = Number(pag.step ?? 100);
      if (!Number.isInteger(step) || step < 1 || step > 1000) return { error: "pagination.step must be 1–1000" };
      pagination.step = step;
    }
  }

  return {
    api: {
      base_url: url, method,
      headers: input.headers ?? {}, query: input.query ?? {},
      ...(method === "POST" ? { body: input.body ?? {} } : {}),
      auth: {
        type: "custom", env: secret ? [secret] : [],
        in: authIn, ...(authName ? { name: authName } : {}), ...(secret ? { secret } : {}),
      },
      response: { ...(root ? { root } : {}), fields: cleanFields, pagination },
    },
  };
}

export function buildCustomConfig(body: CreateInput, existingIds: Set<string>): { config?: SourceConfig; error?: string } {
  const id = String(body.id ?? "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{2,40}$/.test(id)) return { error: "id must be 3–41 chars: lowercase letters, digits, underscore" };
  if (existingIds.has(id) || registry.sources.some((s) => s.id === id)) {
    return { error: `source id already exists: ${id}` };
  }
  const name = String(body.name ?? "").trim();
  if (!name || name.length > 120) return { error: "name is required (max 120 chars)" };
  const adapter = String(body.adapter ?? "");
  if (!ALLOWED_ADAPTERS.includes(adapter)) return { error: `adapter must be one of: ${ALLOWED_ADAPTERS.join(", ")}` };

  const parsed = adapter === "custom_http" ? buildHttpApi(body.http) : parseTokenLines(body.token_lines, ADAPTER_KIND[adapter]);
  if (parsed.error) return { error: parsed.error };
  const quotas = validateQuotas(body.quotas);
  if (quotas.error) return { error: quotas.error };
  const sched = validateSchedule(body, true);
  if (sched.error) return { error: sched.error };

  const group = String(body.group ?? "");
  const validGroup = registry.groups.some((g) => g.id === group) ? group : "G4_etiquette_low_frequency";
  const priority = typeof body.priority === "number" && body.priority >= 1 && body.priority <= 99 ? Math.round(body.priority) : 50;

  const config: SourceConfig = {
    id, name, group: validGroup, priority, enabled: true, status: "active",
    api: adapter === "custom_http"
      ? {
          adapter,
          base_url: parsed.api!.base_url as string,
          auth: parsed.api!.auth as SourceConfig["api"]["auth"],
          ...parsed.api,
        }
      : {
          adapter,
          base_url: (parsed.api?.base_url as string) ?? "",
          auth: { type: "none", env: [] },
          ...parsed.api,
        },
    limits: { level: "self_imposed", quotas: quotas.quotas! },
    schedule: {
      cron: sched.schedule!.cron as string,
      max_requests_per_run: (sched.schedule!.max_requests_per_run as number) ?? 10,
      ...(sched.schedule!.daily_budget !== undefined ? { daily_budget: sched.schedule!.daily_budget as number } : {}),
      ...(sched.schedule!.monthly_budget !== undefined ? { monthly_budget: sched.schedule!.monthly_budget as number } : {}),
      request_delay_s: (sched.schedule!.request_delay_s as number) ?? 3,
    },
    notes: String(body.notes ?? "").slice(0, 500) || "Added via admin panel",
  };
  return { config };
}

// Whitelisted patch for built-in and custom sources. id / api.adapter are never patchable.
export function sanitizePatch(body: Record<string, unknown>): { patch?: Record<string, unknown>; error?: string } {
  const patch: Record<string, unknown> = {};
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") return { error: "enabled must be boolean" };
    patch.enabled = body.enabled;
  }
  if (body.priority !== undefined) {
    if (typeof body.priority !== "number" || body.priority < 1 || body.priority > 99) return { error: "priority must be 1–99" };
    patch.priority = Math.round(body.priority);
  }
  if (body.schedule !== undefined) {
    if (!body.schedule || typeof body.schedule !== "object") return { error: "invalid schedule" };
    const sched = validateSchedule(body.schedule as ScheduleInput, false);
    if (sched.error) return { error: sched.error };
    if (Object.keys(sched.schedule!).length) patch.schedule = sched.schedule;
  }
  if (body.limits !== undefined) {
    const limits = body.limits as Record<string, unknown>;
    if (!limits || typeof limits !== "object") return { error: "invalid limits" };
    if (limits.quotas !== undefined) {
      const q = validateQuotas(limits.quotas);
      if (q.error) return { error: q.error };
      patch.limits = { quotas: q.quotas };
    }
  }
  if (body.api !== undefined) {
    const api = body.api as Record<string, unknown>;
    if (!api || typeof api !== "object") return { error: "invalid api" };
    const apiPatch: Record<string, unknown> = {};
    if (api.token_lines !== undefined && typeof api.adapter_hint === "string" && ADAPTER_KIND[api.adapter_hint]) {
      const parsed = parseTokenLines(api.token_lines, ADAPTER_KIND[api.adapter_hint]);
      if (parsed.error) return { error: parsed.error };
      Object.assign(apiPatch, parsed.api);
    }
    if (api.http_config !== undefined) {
      const r = buildHttpApi(api.http_config);
      if (r.error) return { error: r.error };
      Object.assign(apiPatch, r.api);
    }
    if (api.base_url !== undefined) {
      const err = checkUrl(String(api.base_url));
      if (err) return { error: err };
      apiPatch.base_url = String(api.base_url);
    }
    if (Object.keys(apiPatch).length) patch.api = apiPatch;
  }
  if (!Object.keys(patch).length) return { error: "nothing to update" };
  return { patch };
}

export function applyPatchToCustom(custom: SourceConfig, patch: Record<string, unknown>): SourceConfig {
  const merged = mergePatch(custom, patch);
  merged.id = custom.id;
  merged.api.adapter = custom.api.adapter;
  return merged;
}