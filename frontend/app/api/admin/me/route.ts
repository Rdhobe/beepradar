import { NextRequest, NextResponse } from "next/server";
import { dbGuard } from "@/lib/db/errors";
export const GET = dbGuard(GETImpl);
import { requireAdmin } from "@/lib/admin/auth";

export const dynamic = "force-dynamic";

async function GETImpl(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ admin: false }, { status: 401 });
  return NextResponse.json({ admin: true, email: admin.email });
}