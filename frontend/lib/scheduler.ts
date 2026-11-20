import { sql } from "./db/client";
import { expireStale } from "./pipeline";
import { QuotaTracker } from "./quota";
import { loadRegistry } from "./registry";
import { keysPresent } from "./secrets";
import { runSource, type RunResult } from "./runner";
import { getAdapter } from "./sources";

export async function dueSources(): Promise<string[]> {
  const now = new Date();
  const states = await sql`SELECT source_id, next_due_at, backoff_until, budget_override FROM source_state`;
  const stateMap = new Map(states.map((r) => [r.source_id as string, r]));
  const due: string[] = [];
  const candidates = (await loadRegistry()).sources
    .filter((s) => s.enabled && s.schedule.max_requests_per_run > 0 && getAdapter(s))
    .sort((a, b) => a.priority - b.priority);
  for (const source of candidates) {
    if (!(await keysPresent(source))) continue;
    const state = stateMap.get(source.id);
    if (state?.backoff_until && new Date(state.backoff_until) > now) continue;
    if (state?.next_due_at && new Date(state.next_due_at) > now) continue;
    const tracker = new QuotaTracker(source, state?.budget_override ?? null);
    if ((await tracker.requestsLeftThisRun()) <= 0) continue;
    due.push(source.id);
  }
  return due;
}

export interface TickResult {
  ran: RunResult[];
  still_due: string[];
  expired: number;
  elapsed_ms: number;
}

// Resumable tick: runs due sources in priority order until the time budget is
// nearly spent. Unfinished sources keep next_due_at in the past so the next
// ping picks up where this one stopped.
export async function tick(budgetMs = 50_000): Promise<TickResult> {
  const start = Date.now();
  const ran: RunResult[] = [];
  const due = await dueSources();
  const stillDue: string[] = [];
  for (const sourceId of due) {
    if (Date.now() - start > budgetMs - 12_000) {
      stillDue.push(sourceId);
      continue;
    }
    const result = await runSource(sourceId);
    ran.push(result);
    if (result.status === "quota_exhausted") {
      stillDue.push(sourceId);
    }
  }
  let expired = 0;
  if (Date.now() - start < budgetMs - 2_000) expired = await expireStale();
  return { ran, still_due: stillDue, expired, elapsed_ms: Date.now() - start };
}

export interface SelectedSkip { source: string; reason: string }
export interface SelectedResult extends TickResult { skipped: SelectedSkip[] }

// Manual bulk run: same quota-aware, priority-ordered, connected-only,
// time-budgeted pipeline as tick(), but for an explicit set of source ids.
// Sources still cooling down from a recent run are skipped (reason "cooldown").
// Unfinished sources are reported in still_due so the selection can be re-run
// to pick up where it stopped.
export async function runSelected(sourceIds: string[], budgetMs = 38_000, maxSources = 5): Promise<SelectedResult> {
  const start = Date.now();
  const now = new Date();
  const wanted = new Set(sourceIds);
  const states = await sql`SELECT source_id, backoff_until, next_due_at, budget_override FROM source_state`;
  const stateMap = new Map(states.map((r) => [r.source_id as string, r]));
  const sources = (await loadRegistry()).sources;
  const known = new Set(sources.map((s) => s.id));

  const skipped: SelectedSkip[] = [];
  for (const id of wanted) if (!known.has(id)) skipped.push({ source: id, reason: "unknown_source" });

  const runnable: string[] = [];
  for (const source of sources.filter((s) => wanted.has(s.id)).sort((a, b) => a.priority - b.priority)) {
    if (!source.enabled) { skipped.push({ source: source.id, reason: "disabled" }); continue; }
    if (!getAdapter(source)) { skipped.push({ source: source.id, reason: "no_adapter" }); continue; }
    if (!(await keysPresent(source))) { skipped.push({ source: source.id, reason: "no_key" }); continue; }
    const state = stateMap.get(source.id);
    if (state?.backoff_until && new Date(state.backoff_until) > now) { skipped.push({ source: source.id, reason: "backoff" }); continue; }
    if (state?.next_due_at && new Date(state.next_due_at) > now) { skipped.push({ source: source.id, reason: "cooldown" }); continue; }
    const tracker = new QuotaTracker(source, state?.budget_override ?? null);
    if ((await tracker.requestsLeftThisRun()) <= 0) { skipped.push({ source: source.id, reason: "quota_exhausted" }); continue; }
    runnable.push(source.id);
  }

  const ran: RunResult[] = [];
  const stillDue: string[] = [];
  for (const sourceId of runnable) {
    if (ran.length >= maxSources || Date.now() - start > budgetMs - 12_000) { stillDue.push(sourceId); continue; }
    const result = await runSource(sourceId);
    ran.push(result);
    if (result.status === "quota_exhausted") stillDue.push(sourceId);
  }
  let expired = 0;
  if (Date.now() - start < budgetMs - 2_000) expired = await expireStale();
  return { ran, still_due: stillDue, skipped, expired, elapsed_ms: Date.now() - start };
}