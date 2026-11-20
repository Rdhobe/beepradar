import { NextRequest, NextResponse } from "next/server";
import { dbGuard } from "@/lib/db/errors";
export const POST = dbGuard(POSTImpl, 55000);
import { requireAdmin } from "@/lib/admin/auth";
import { runSource } from "@/lib/runner";
import { runSelected, tick } from "@/lib/scheduler";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

async function POSTImpl(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "admin access required" }, { status: 401 });

  let body: { source_id?: string; source_ids?: string[]; limit?: number } = {};
  try {
    body = await req.json();
  } catch { /* empty body = run all due */ }

  if (body.source_id) {
    const limit = typeof body.limit === "number" && body.limit > 0 ? Math.min(body.limit, 500) : undefined;
    const result = await runSource(body.source_id, limit);
    return NextResponse.json({ mode: "single", result });
  }
  if (Array.isArray(body.source_ids) && body.source_ids.length) {
    const ids = body.source_ids.filter((x) => typeof x === "string").slice(0, 100);
    const result = await runSelected(ids, 38_000, 5);
    return NextResponse.json({ mode: "selected", ...result });
  }
  const result = await tick(38_000);
  return NextResponse.json({ mode: "tick", ...result });
}