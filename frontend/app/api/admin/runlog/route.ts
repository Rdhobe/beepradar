import { NextRequest, NextResponse } from "next/server";
import { dbGuard } from "@/lib/db/errors";
export const GET = dbGuard(GETImpl);
import { requireAdmin } from "@/lib/admin/auth";
import { sql } from "@/lib/db/client";
import { rest, ensureRest } from "@/lib/db/rest";

export const dynamic = "force-dynamic";

const RUN_COLS = "source,started_at,finished_at,fetched,passed_filter,inserted,dup_url,dup_fingerprint,dup_fuzzy,error";

async function GETImpl(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "admin access required" }, { status: 401 });

  // Reads go over REST when available so live-log polling never loads the wire pooler.
  // A killed/aborted run leaves last_status='running'; a short window drops it quickly
  // instead of showing a phantom RUNNING row for ten minutes.
  const since = new Date(Date.now() - 2 * 60_000).toISOString();
  if (await ensureRest()) {
    const [runs, states] = await Promise.all([
      rest(`ingest_runs?select=${RUN_COLS}&order=started_at.desc&limit=40`),
      rest(`source_state?select=source_id,last_run_at&last_status=eq.running&last_run_at=gte.${encodeURIComponent(since)}`),
    ]);
    return NextResponse.json({
      running: states.rows.map((r) => ({ source: r.source_id, since: r.last_run_at })),
      runs: runs.rows,
    });
  }
  const runs = await sql`
    SELECT source, started_at, finished_at, fetched, passed_filter, inserted,
      dup_url, dup_fingerprint, dup_fuzzy, error
    FROM ingest_runs ORDER BY started_at DESC LIMIT 40`;
  const states = await sql`
    SELECT source_id, last_run_at FROM source_state
    WHERE last_status = 'running' AND last_run_at > now() - interval '2 minutes'`;
  return NextResponse.json({
    running: states.map((r) => ({ source: r.source_id, since: r.last_run_at })),
    runs,
  });
}