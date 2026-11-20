import { NextRequest, NextResponse } from "next/server";
import { dbGuard } from "@/lib/db/errors";
export const GET = dbGuard(GETImpl);
export const POST = dbGuard(POSTImpl);
import { requireAdmin } from "@/lib/admin/auth";
import { requiredKeys } from "@/lib/admin/integrations";
import { sql } from "@/lib/db/client";
import { loadRegistry } from "@/lib/registry";
import { masterKeyPresent, saveSecret, secretStatus } from "@/lib/secrets";

export const dynamic = "force-dynamic";

const NAME_RE = /^[A-Z][A-Z0-9_]{1,60}$/;

async function GETImpl(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "admin access required" }, { status: 401 });

  const reg = await loadRegistry();
  const usedBy = new Map<string, string[]>();
  for (const s of reg.sources) {
    for (const k of requiredKeys(s)) usedBy.set(k, [...(usedBy.get(k) ?? []), s.id]);
  }
  let dbNames: string[] = [];
  try {
    const rows = await sql`SELECT key_name, updated_at FROM integration_secrets`;
    dbNames = rows.map((r) => r.key_name as string);
  } catch { /* table not created yet */ }
  const names = [...new Set([...usedBy.keys(), ...dbNames])].sort();
  const status = await secretStatus(names);
  return NextResponse.json({
    master_key_present: masterKeyPresent(),
    secrets: names.map((name) => ({ name, ...status[name], used_by: usedBy.get(name) ?? [] })),
  });
}

async function POSTImpl(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "admin access required" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const name = String(body.name ?? "").trim();
  const value = String(body.value ?? "");
  if (!NAME_RE.test(name)) return NextResponse.json({ error: "name must be a KEY_NAME like RAPIDAPI_KEY (uppercase, underscores)" }, { status: 400 });
  if (!value.trim() || value.length > 500) return NextResponse.json({ error: "value is required (max 500 chars)" }, { status: 400 });
  if (!masterKeyPresent()) {
    return NextResponse.json(
      { error: "SOURCE_KEYS_SECRET is not configured on the server — set it (64 hex chars) before saving keys" },
      { status: 400 },
    );
  }
  await saveSecret(name, value.trim());
  return NextResponse.json({ ok: true, name });
}