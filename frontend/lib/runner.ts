import { sql } from "./db/client";
import { QuotaClient } from "./http";
import { expireStale, ingestRawJobs, type IngestCounts } from "./pipeline";
import { applyBackoff, clearBackoff, QuotaTracker, RateLimited } from "./quota";
import { getSourceConfig, RUN_COOLDOWN_MS } from "./registry";
import { keysPresent, redactSecrets, resolveKeys, withSecrets } from "./secrets";
import { getAdapter } from "./sources";

export interface RunResult extends Partial<IngestCounts> {
  source: string;
  status: string;
  error?: string;
  backoff_until?: Date;
  cooldown_until?: Date;
}

export async function runSource(sourceId: string, limit?: number): Promise<RunResult> {
  const source = await getSourceConfig(sourceId);
  if (!source) return { source: sourceId, status: "unknown_source" };
  if (!source.enabled) return { source: sourceId, status: "disabled" };
  if (!(await keysPresent(source))) return { source: sourceId, status: "skipped_no_key" };
  const adapter = getAdapter(source);
  if (!adapter) return { source: sourceId, status: "no_adapter" };

  const state = await sql`SELECT backoff_until, next_due_at, budget_override FROM source_state WHERE source_id = ${sourceId}`;
  const backoffUntil = state[0]?.backoff_until as Date | null;
  if (backoffUntil && new Date(backoffUntil) > new Date()) {
    return { source: sourceId, status: "backoff", backoff_until: backoffUntil };
  }
  const cooldownUntilExisting = state[0]?.next_due_at as Date | null;
  if (cooldownUntilExisting && new Date(cooldownUntilExisting) > new Date()) {
    return { source: sourceId, status: "cooldown", cooldown_until: cooldownUntilExisting };
  }
  const cooldownUntil = new Date(Date.now() + RUN_COOLDOWN_MS);
  const tracker = new QuotaTracker(source, state[0]?.budget_override ?? null);
  if ((await tracker.requestsLeftThisRun()) <= 0) {
    return { source: sourceId, status: "quota_exhausted" };
  }
  await sql`
    INSERT INTO source_state (source_id, last_run_at, last_status)
    VALUES (${sourceId}, now(), 'running')
    ON CONFLICT (source_id) DO UPDATE SET last_run_at = EXCLUDED.last_run_at, last_status = EXCLUDED.last_status`;
  const { keys } = await resolveKeys(source.api.auth?.env ?? []);
  const secretValues = Object.values(keys);
  const client = new QuotaClient(source, tracker, secretValues);
  try {
    const rawJobs = await withSecrets(keys, () => adapter.fetch(client, limit));
    const counts = await ingestRawJobs(sourceId, rawJobs);
    await clearBackoff(sourceId);
    await sql`
      INSERT INTO source_state (source_id, last_run_at, last_status, next_due_at)
      VALUES (${sourceId}, now(), 'ok', ${cooldownUntil})
      ON CONFLICT (source_id) DO UPDATE SET last_run_at = EXCLUDED.last_run_at, last_status = EXCLUDED.last_status, next_due_at = EXCLUDED.next_due_at`;
    return { source: sourceId, status: "ok", cooldown_until: cooldownUntil, ...counts };
  } catch (e) {
    if (e instanceof RateLimited) {
      const until = await applyBackoff(sourceId, e.retryAfterS);
      await sql`UPDATE source_state SET next_due_at = ${cooldownUntil} WHERE source_id = ${sourceId}`;
      return { source: sourceId, status: "rate_limited", backoff_until: until, cooldown_until: cooldownUntil };
    }
    const msg = redactSecrets(String(e instanceof Error ? e.message : e), secretValues).slice(0, 300);
    await sql`
      INSERT INTO source_state (source_id, last_run_at, last_status, next_due_at)
      VALUES (${sourceId}, now(), ${"error: " + msg.slice(0, 200)}, ${cooldownUntil})
      ON CONFLICT (source_id) DO UPDATE SET last_run_at = EXCLUDED.last_run_at, last_status = EXCLUDED.last_status, next_due_at = EXCLUDED.next_due_at`;
    return { source: sourceId, status: "error", error: msg, cooldown_until: cooldownUntil };
  }
}

export async function runDueSources(): Promise<RunResult[]> {
  const { dueSources } = await import("./scheduler");
  const results: RunResult[] = [];
  for (const sourceId of await dueSources()) {
    results.push(await runSource(sourceId));
  }
  const expired = await expireStale();
  if (expired) console.log(`expired ${expired} stale jobs`);
  return results;
}