import { sql } from "./db/client";
import { SAFETY_MARGIN, type SourceConfig } from "./registry";

export class QuotaExhausted extends Error {}
export class RateLimited extends Error {
  retryAfterS: number | null;
  constructor(retryAfterS: number | null) {
    super(`429 rate limited (retry after ${retryAfterS}s)`);
    this.retryAfterS = retryAfterS;
  }
}

export function windowKeys(now: Date): Record<string, string> {
  const iso = now.toISOString();
  const week = isoWeek(now);
  return {
    minute: "m:" + iso.slice(0, 16),
    hour: "h:" + iso.slice(0, 13),
    day: "d:" + iso.slice(0, 10),
    week: "w:" + week,
    month: "M:" + iso.slice(0, 7),
  };
}

function isoWeek(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export function parseQuotas(source: SourceConfig, safety = SAFETY_MARGIN): Record<string, number> {
  const caps: Record<string, number> = {};
  const margin = source.limits?.level === "official" ? 0.9 : safety;
  for (const q of source.limits?.quotas ?? []) {
    if (!q.n || ["concurrent", "none"].includes(q.per)) continue;
    if (q.per === "40s") {
      const cap = Math.max(1, Math.floor((q.n * 60) / 40 * margin));
      caps.minute = Math.min(caps.minute ?? cap, cap);
    } else if (["minute", "hour", "day", "week", "month"].includes(q.per)) {
      const cap = Math.max(1, Math.floor(q.n * margin));
      caps[q.per] = Math.min(caps[q.per] ?? cap, cap);
    }
  }
  const sched = source.schedule;
  if (sched.daily_budget) caps.day = Math.min(caps.day ?? sched.daily_budget, sched.daily_budget);
  if (sched.monthly_budget) caps.month = Math.min(caps.month ?? sched.monthly_budget, sched.monthly_budget);
  return caps;
}

export class QuotaTracker {
  sourceId: string;
  caps: Record<string, number>;
  maxPerRun: number;
  runRequests = 0;

  constructor(source: SourceConfig, budgetOverride?: number | null) {
    this.sourceId = source.id;
    this.caps = parseQuotas(source);
    this.maxPerRun = source.schedule.max_requests_per_run ?? 50;
    if (budgetOverride != null && this.caps.day != null) {
      this.caps.day = Math.min(this.caps.day, budgetOverride);
    }
  }

  async remaining(): Promise<Record<string, number>> {
    const keys = windowKeys(new Date());
    const rows = await sql`
      SELECT quota_window, count FROM source_quota_usage
      WHERE source_id = ${this.sourceId} AND quota_window IN ${sql(Object.values(keys))}`;
    const used = new Map(rows.map((r) => [r.quota_window as string, r.count as number]));
    const out: Record<string, number> = {};
    for (const [w, cap] of Object.entries(this.caps)) out[w] = cap - (used.get(keys[w]) ?? 0);
    return out;
  }

  async canRequest(): Promise<boolean> {
    if (this.runRequests >= this.maxPerRun) return false;
    const rem = await this.remaining();
    return Object.values(rem).every((v) => v > 0);
  }

  async recordRequest(): Promise<void> {
    const keys = windowKeys(new Date());
    const rows = Object.values(keys).map((k) => ({ source_id: this.sourceId, quota_window: k, count: 1 }));
    await sql`
      INSERT INTO source_quota_usage ${sql(rows, "source_id", "quota_window", "count")}
      ON CONFLICT (source_id, quota_window) DO UPDATE SET count = source_quota_usage.count + 1`;
    this.runRequests += 1;
  }

  async requestsLeftThisRun(): Promise<number> {
    const rem = await this.remaining();
    return Math.max(0, Math.min(this.maxPerRun - this.runRequests, ...Object.values(rem)));
  }
}

export async function applyBackoff(sourceId: string, retryAfterS: number | null): Promise<Date> {
  const rows = await sql`SELECT consecutive_429, budget_override FROM source_state WHERE source_id = ${sourceId}`;
  const streak = (rows[0]?.consecutive_429 ?? 0) + 1;
  const hours = Math.min(24, 2 ** (streak - 1));
  const delayMs = retryAfterS ? retryAfterS * 1000 : hours * 3600 * 1000;
  const until = new Date(Date.now() + delayMs);
  let override: number | null = null;
  if (streak >= 3) {
    const { sourceConfig } = await import("./registry");
    const base = rows[0]?.budget_override ?? sourceConfig(sourceId)?.schedule.daily_budget ?? 100;
    override = Math.max(1, Math.floor(base / 2));
  }
  await sql`
    INSERT INTO source_state (source_id, backoff_until, consecutive_429, budget_override, last_status)
    VALUES (${sourceId}, ${until}, ${streak}, ${override}, 'backoff_429')
    ON CONFLICT (source_id) DO UPDATE SET
      backoff_until = EXCLUDED.backoff_until,
      consecutive_429 = EXCLUDED.consecutive_429,
      budget_override = EXCLUDED.budget_override,
      last_status = EXCLUDED.last_status`;
  return until;
}

export async function clearBackoff(sourceId: string): Promise<void> {
  await sql`UPDATE source_state SET consecutive_429 = 0, backoff_until = NULL WHERE source_id = ${sourceId}`;
}

// Batched equivalent of QuotaTracker.requestsLeftThisRun() for many sources at
// once (single usage query), so the admin ready-queue doesn't fire N queries.
export async function quotaLeftMap(
  sources: SourceConfig[],
  overrides?: Map<string, number | null>,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!sources.length) return out;
  const wk = windowKeys(new Date());
  const rows = await sql`
    SELECT source_id, quota_window, count FROM source_quota_usage
    WHERE source_id IN ${sql(sources.map((s) => s.id))} AND quota_window IN ${sql(Object.values(wk))}`;
  const used = new Map<string, Map<string, number>>();
  for (const r of rows) {
    let m = used.get(r.source_id as string);
    if (!m) { m = new Map(); used.set(r.source_id as string, m); }
    m.set(r.quota_window as string, r.count as number);
  }
  for (const s of sources) {
    const caps = parseQuotas(s);
    const ov = overrides?.get(s.id);
    if (ov != null && caps.day != null) caps.day = Math.min(caps.day, ov);
    const u = used.get(s.id);
    const rem = Object.entries(caps).map(([w, cap]) => cap - (u?.get(wk[w]) ?? 0));
    const maxPerRun = s.schedule.max_requests_per_run ?? 50;
    out.set(s.id, Math.max(0, Math.min(maxPerRun, ...rem)));
  }
  return out;
}