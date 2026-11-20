import { NextRequest, NextResponse } from "next/server";
import { dbGuard } from "@/lib/db/errors";
export const POST = dbGuard(POSTImpl, 55000);
import { requireAdmin } from "@/lib/admin/auth";
import { ruleTagUntagged } from "@/lib/rule_tagger";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

async function POSTImpl(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "admin access required" }, { status: 401 });
  let body: { reapply?: boolean } = {};
  try {
    body = await req.json();
  } catch { /* defaults */ }
  const stats = await ruleTagUntagged(400, 20, !!body.reapply);
  return NextResponse.json({ status: "ok", reapply: !!body.reapply, ...stats });
}