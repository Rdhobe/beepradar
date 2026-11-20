import postgres from "postgres";

const globalForDb = globalThis as unknown as { sql?: postgres.Sql; sqlKey?: string };

const url = process.env.DATABASE_URL!;

// Supabase's transaction pooler (port 6543) requires SSL and forbids prepared
// statements. max>1 lets concurrent route handlers run in parallel instead of
// queueing on one connection (max:1 deadlocks under a burst of requests); a
// longer idle_timeout keeps the pool warm so bursts don't pay a fresh connect.
// statement_timeout is honored on a direct connection (the pooler ignores it);
// the auto-cancel below is what bounds queries on the pooler.
const options = {
  max: 5,
  idle_timeout: 60,
  connect_timeout: 10,
  max_lifetime: 300,
  prepare: false,
  ssl: "require",
  connection: { statement_timeout: 12000 },
} as const;

// Every wire query is cancelled server-side (out-of-band CancelRequest) if it
// exceeds this deadline. Abandoning a query instead (just racing a timeout)
// leaves the pooler backend stuck in ClientRead forever, saturating the pool
// and causing the next request to time out — a self-sustaining spiral. Cancelling
// rolls the statement back and frees the backend, so a slow query becomes a
// per-source error instead of poisoning the whole pool.
const QUERY_DEADLINE_MS = 12_000;

function bound<T>(q: T): T {
  const pq = q as { then?: unknown; cancel?: () => void };
  if (pq && typeof pq.then === "function" && typeof pq.cancel === "function") {
    const t = setTimeout(() => {
      try { pq.cancel!(); } catch { /* already settled */ }
    }, QUERY_DEADLINE_MS);
    (pq as Promise<unknown>).then(() => clearTimeout(t), () => clearTimeout(t));
  }
  return q;
}

// Recreate when the URL or pool options change so .env edits and tuning take
// effect on the next module evaluation. Do NOT force-close the old client:
// .end({timeout:0}) kills sockets mid-query and orphans the session on the
// transaction pooler (it sticks in ClientRead forever, leaking a pool slot).
// Dropping the reference lets its connections idle out gracefully instead.
const key = url + "|" + JSON.stringify(options);
if (globalForDb.sql && globalForDb.sqlKey !== key) {
  globalForDb.sql = undefined;
}

const raw = globalForDb.sql ?? postgres(url, options);
globalForDb.sql = raw;
globalForDb.sqlKey = key;

// Wrap the tag/function so each returned PendingQuery gets the cancel deadline.
// Helper calls (sql(rows, cols), sql.json, sql(array)) return SQL fragments with
// no .then/.cancel and pass through untouched.
const sql = new Proxy(raw, {
  apply(target, thisArg, args) {
    return bound(Reflect.apply(target, thisArg, args));
  },
  get(target, prop, receiver) {
    const v = Reflect.get(target, prop, receiver);
    if (typeof v === "function") return (...a: unknown[]) => bound(v.apply(target, a));
    return v;
  },
}) as postgres.Sql;

export { sql };