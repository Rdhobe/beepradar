import { NextRequest, NextResponse } from "next/server";
import { dbGuard } from "@/lib/db/errors";
export const PATCH = dbGuard(PATCHImpl);
export const DELETE = dbGuard(DELETEImpl);
import { requireAdmin } from "@/lib/admin/auth";
import { applyPatchToCustom, sanitizePatch } from "@/lib/admin/validate";
import { sql } from "@/lib/db/client";
import { getSourceConfig, invalidateRegistryCache, mergePatch, registry, type SourceConfig } from "@/lib/registry";

export const dynamic = "force-dynamic";

async function PATCHImpl(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "admin access required" }, { status: 401 });
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { patch, error } = sanitizePatch(body);
  if (error || !patch) return NextResponse.json({ error }, { status: 400 });

  const rows = await sql`SELECT patch, custom FROM source_admin WHERE source_id = ${id}`;
  const row = rows[0];

  if (row?.custom) {
    const merged = applyPatchToCustom(row.custom as SourceConfig, patch);
    await sql`UPDATE source_admin SET custom = ${sql.json(merged as any)}, updated_at = now() WHERE source_id = ${id}`;
    invalidateRegistryCache();
    return NextResponse.json({ ok: true, source: merged });
  }

  if (!registry.sources.some((s) => s.id === id)) {
    return NextResponse.json({ error: `unknown source: ${id}` }, { status: 404 });
  }
  const mergedPatch = mergePatch((row?.patch as Record<string, unknown>) ?? {}, patch);
  await sql`
    INSERT INTO source_admin (source_id, patch, updated_at)
    VALUES (${id}, ${sql.json(mergedPatch as any)}, now())
    ON CONFLICT (source_id) DO UPDATE SET patch = EXCLUDED.patch, updated_at = now()`;
  invalidateRegistryCache();
  return NextResponse.json({ ok: true, source: await getSourceConfig(id) });
}

async function DELETEImpl(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "admin access required" }, { status: 401 });
  const { id } = await params;

  const rows = await sql`SELECT custom FROM source_admin WHERE source_id = ${id}`;
  if (!rows[0]?.custom) {
    return NextResponse.json({ error: "built-in sources cannot be deleted — disable them instead" }, { status: 400 });
  }
  await sql`DELETE FROM source_admin WHERE source_id = ${id}`;
  invalidateRegistryCache();
  return NextResponse.json({ ok: true });
}