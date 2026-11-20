import { NextRequest, NextResponse } from "next/server";
import { dbGuard } from "@/lib/db/errors";
export const POST = dbGuard(POSTImpl, 55000);
import { requireAdmin } from "@/lib/admin/auth";
import { sql } from "@/lib/db/client";
import { resolveTaggingConfig } from "@/lib/llm_config";
import { ruleTagUntagged } from "@/lib/rule_tagger";
import { tagPending } from "@/lib/tagger";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

async function POSTImpl(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "admin access required" }, { status: 401 });

  let body: { max_batches?: number; retry_failed?: boolean; include_rule_tagged?: boolean } = {};
  try {
    body = await req.json();
  } catch { /* defaults */ }

  const cfg = await resolveTaggingConfig();
  if (cfg.mode === "free") {
    const stats = await ruleTagUntagged();
    return NextResponse.json({ mode: "free", status: "ok", ...stats });
  }

  let reset = 0;
  if (body.retry_failed) {
    const rows = await sql`UPDATE jobs SET tag_status = 'pending' WHERE tag_status = 'failed' RETURNING id`;
    reset = rows.length;
  }
  const maxBatches = typeof body.max_batches === "number" && body.max_batches > 0
    ? Math.min(Math.round(body.max_batches), 50) : 10;
  // Default to upgrading rule-tagged rows so the paid pass actually has work
  // after the free ingest tagging already marked everything done.
  const includeRuleTagged = body.include_rule_tagged !== false;
  const stats = await tagPending(maxBatches, 50_000, includeRuleTagged);
  return NextResponse.json({ mode: "llm", provider: cfg.provider, model: cfg.model, reset_failed: reset, ...stats });
}