import { NextRequest, NextResponse } from "next/server";
import { dbGuard } from "@/lib/db/errors";
export const GET = dbGuard(GETImpl);
export const POST = dbGuard(POSTImpl);
import { requireAdmin } from "@/lib/admin/auth";
import { integrationInfo, requiredKeys } from "@/lib/admin/integrations";
import { buildCustomConfig } from "@/lib/admin/validate";
import { sql } from "@/lib/db/client";
import { invalidateRegistryCache, loadRegistry, registry } from "@/lib/registry";
import { quotaLeftMap } from "@/lib/quota";
import { masterKeyPresent, secretStatus } from "@/lib/secrets";

export const dynamic = "force-dynamic";

async function GETImpl(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "admin access required — sign in with an ADMIN_EMAILS account" }, { status: 401 });

  const reg = await loadRegistry();
  const states = await sql`SELECT * FROM source_state`;
  const stateMap = new Map(states.map((r) => [r.source_id as string, r]));
  const quota = await sql`SELECT source_id, count FROM source_quota_usage WHERE quota_window LIKE 'd:%'`;
  const quotaMap = new Map(quota.map((r) => [r.source_id as string, r.count as number]));
  const overrides = new Map(states.map((r) => [r.source_id as string, (r.budget_override ?? null) as number | null]));
  const leftMap = await quotaLeftMap(reg.sources, overrides);
  const customRows = await sql`SELECT source_id FROM source_admin WHERE custom IS NOT NULL`;
  const customIds = new Set(customRows.map((r) => r.source_id as string));

  const entries = reg.sources.map((s) => ({ s, custom: customIds.has(s.id) }));
  const info = await integrationInfo(entries);

  const usedBy = new Map<string, string[]>();
  for (const { s } of entries) {
    for (const k of requiredKeys(s)) {
      usedBy.set(k, [...(usedBy.get(k) ?? []), s.id]);
    }
  }
  let dbNames: string[] = [];
  try {
    const rows = await sql`SELECT key_name FROM integration_secrets`;
    dbNames = rows.map((r) => r.key_name as string);
  } catch { /* table not created yet */ }
  const allNames = [...new Set([...usedBy.keys(), ...dbNames])].sort();
  const status = await secretStatus(allNames);
  const secrets = allNames.map((name) => ({ name, ...status[name], used_by: usedBy.get(name) ?? [] }));

  return NextResponse.json({
    email: admin.email,
    groups: reg.groups,
    master_key_present: masterKeyPresent(),
    secrets,
    sources: reg.sources.map((s) => ({
      ...s,
      custom: customIds.has(s.id),
      state: stateMap.get(s.id) ?? null,
      quota_today: quotaMap.get(s.id) ?? 0,
      quota_left: leftMap.get(s.id) ?? 0,
      integration: info.get(s.id),
    })),
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
  const existing = await sql`SELECT source_id FROM source_admin`;
  const ids = new Set<string>([
    ...registry.sources.map((s) => s.id),
    ...existing.map((r) => r.source_id as string),
  ]);
  const { config, error } = buildCustomConfig(body, ids);
  if (error || !config) return NextResponse.json({ error }, { status: 400 });

  await sql`
    INSERT INTO source_admin (source_id, custom, updated_at)
    VALUES (${config.id}, ${sql.json(config as any)}, now())`;
  invalidateRegistryCache();
  return NextResponse.json({ ok: true, source: config }, { status: 201 });
}