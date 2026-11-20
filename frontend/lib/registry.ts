import registryJson from "@/data/sources_registry.json";

export interface Quota {
  n: number | null;
  per: string;
  hard?: boolean;
  kind?: string;
  scope?: string;
  confidence?: string;
  reset?: string;
}

export interface SourceConfig {
  id: string;
  name: string;
  group: string;
  priority: number;
  enabled: boolean;
  status: string;
  disabled_reason?: string;
  api: {
    base_url: string;
    method?: string;
    auth: { type: string; env: string[] };
    params_example?: Record<string, unknown>;
    query_loop?: { what: string[]; where: string[]; pages: number };
    repos?: { repo: string; license: string; use: string }[];
    feeds?: string[];
    known_india_tokens?: string[];
    candidate_tokens?: string[];
    tokens_file?: string;
    seeds_file?: string;
    second_hop?: string;
    note?: string;
    [k: string]: unknown;
  };
  limits: { level: string; quotas: Quota[]; reference?: string | null; note?: string };
  schedule: {
    cron: string;
    max_requests_per_run: number;
    daily_budget?: number;
    monthly_budget?: number;
    request_delay_s?: number;
    scope?: string;
  };
  india?: { coverage: string; filter: string };
  compliance?: { attribution?: string; terms_note?: string };
  notes?: string;
}

export interface Registry {
  version: number;
  scheduler: Record<string, unknown>;
  groups: { id: string; name: string; policy: string }[];
  sources: SourceConfig[];
  blocklist_never_fetch: string[];
}

export const registry = registryJson as unknown as Registry;

export function sourceConfig(id: string): SourceConfig | undefined {
  return registry.sources.find((s) => s.id === id);
}

// Objects merge recursively; arrays and scalars are replaced wholesale.
// null/undefined patch values keep the base value.
export function mergePatch<T>(base: T, patch: unknown): T {
  if (patch === null || patch === undefined) return base;
  if (Array.isArray(patch) || typeof patch !== "object") return patch as T;
  if (typeof base !== "object" || base === null || Array.isArray(base)) return patch as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    out[k] = mergePatch((base as Record<string, unknown>)[k], v);
  }
  return out as T;
}

let cache: { at: number; reg: Registry } | null = null;
const CACHE_TTL_MS = 30_000;

export function invalidateRegistryCache(): void {
  cache = null;
}

// Built-in JSON catalog + DB admin patches + user-added custom sources.
// Falls back to the built-in catalog when the DB is unreachable.
export async function loadRegistry(): Promise<Registry> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.reg;
  try {
    // source_admin holds admin patches/custom configs that may embed API tokens,
    // so it is read over the authenticated wire only — never the anon REST key.
    const { sql } = await import("./db/client");
    const rows: any[] = await sql`SELECT source_id, patch, custom FROM source_admin`;
    const byId = new Map(rows.map((r) => [r.source_id as string, r]));
    const sources = registry.sources.map((s) => {
      const row = byId.get(s.id);
      return row && !row.custom && row.patch ? mergePatch(s, row.patch) : s;
    });
    for (const r of rows) {
      if (r.custom) sources.push(r.custom as SourceConfig);
    }
    const reg: Registry = { ...registry, sources };
    cache = { at: Date.now(), reg };
    return reg;
  } catch (e) {
    console.error("loadRegistry: source_admin unavailable, using built-in registry:", e);
    return registry;
  }
}

export async function getSourceConfig(id: string): Promise<SourceConfig | undefined> {
  return (await loadRegistry()).sources.find((s) => s.id === id);
}

export function blocklistDomains(): string[] {
  return registry.blocklist_never_fetch;
}

export function envKeysPresent(source: SourceConfig): boolean {
  return (source.api.auth?.env ?? []).every((k) => !!process.env[k]);
}

export const SAFETY_MARGIN = 0.8;
export const FUZZY_THRESHOLD = 0.85;
export const STALE_DAYS = 14;
// After any run attempt a source cools down for this long before it can run
// again. Stored in source_state.next_due_at; enforced by runSource, the
// scheduler and the admin ready queue.
export const RUN_COOLDOWN_MS = 6 * 60 * 60 * 1000;
export const LLM_MODEL = process.env.LLM_MODEL || "claude-haiku-5-5";
export const LLM_BATCH_SIZE = parseInt(process.env.LLM_BATCH_SIZE || "10", 10);
export const USER_AGENT =
  process.env.USER_AGENT || "BeepRadarBot/1.0 (+https://localhost; contact: you@example.com)";