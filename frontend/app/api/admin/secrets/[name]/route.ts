import { NextRequest, NextResponse } from "next/server";
import { dbGuard } from "@/lib/db/errors";
export const DELETE = dbGuard(DELETEImpl);
import { requireAdmin } from "@/lib/admin/auth";
import { deleteSecret } from "@/lib/secrets";

async function DELETEImpl(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "admin access required" }, { status: 401 });
  const { name } = await params;
  if (!/^[A-Z][A-Z0-9_]{1,60}$/.test(name)) return NextResponse.json({ error: "invalid key name" }, { status: 400 });
  await deleteSecret(name);
  return NextResponse.json({ ok: true, name });
}