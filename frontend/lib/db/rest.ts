// Stateless PostgREST reads over HTTPS. Unlike the postgres wire pooler, each
// request is independent: an aborted fetch rolls back server-side and releases
// the backend, so a timed-out read can never orphan a pooled connection.
const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// REST is only usable once the anon key has SELECT permission (GRANT + RLS).
// Probe at load and re-probe at most every 30s while disabled, so applying the
// grants takes effect without a restart. Callers await ensureRest() so a cold
// first request waits for the probe rather than falling back to the wire pool
// (which can be saturated); only a genuinely failed probe uses the wire.
let restOk = false;
let lastProbeAt = 0;
let probePromise: Promise<void> | null = null;
function probe(): Promise<void> {
  if (!BASE || !KEY) return Promise.resolve();
  lastProbeAt = Date.now();
  probePromise = fetch(`${BASE}/rest/v1/jobs?select=id&limit=1`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  })
    .then((r) => { restOk = r.ok; })
    .catch(() => { restOk = false; })
    .finally(() => { probePromise = null; });
  return probePromise;
}
probe();

export async function ensureRest(): Promise<boolean> {
  if (restOk) return true;
  if (!probePromise && Date.now() - lastProbeAt > 30_000) probe();
  if (probePromise) await probePromise;
  return restOk;
}

export interface RestResult {
  rows: any[];
  total: number | null;
}

export async function rest(
  path: string,
  opts: { count?: boolean; timeoutMs?: number } = {},
): Promise<RestResult> {
  const headers: Record<string, string> = {
    apikey: KEY!,
    Authorization: `Bearer ${KEY}`,
    Accept: "application/json",
  };
  if (opts.count) headers.Prefer = "count=exact";
  const resp = await fetch(`${BASE}/rest/v1/${path}`, {
    headers,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw Object.assign(new Error(`rest ${resp.status}: ${text.slice(0, 140)}`), {
      code: `REST_${resp.status}`,
    });
  }
  const rows = (await resp.json()) as any[];
  const range = resp.headers.get("content-range");
  const total = range && range.includes("/") ? parseInt(range.split("/")[1], 10) : null;
  return { rows, total };
}

export const eq = (col: string, v: string | number | boolean) => `${col}=eq.${encodeURIComponent(String(v))}`;
export const neq = (col: string, v: string) => `${col}=neq.${encodeURIComponent(v)}`;
export const isNull = (col: string) => `${col}=is.null`;
export const notNull = (col: string) => `${col}=not.is.null`;