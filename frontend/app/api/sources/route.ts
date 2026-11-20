import { NextResponse } from "next/server";
import { dbGuard } from "@/lib/db/errors";
export const GET = dbGuard(GETImpl);
import { sql } from "@/lib/db/client";
import { rest, ensureRest } from "@/lib/db/rest";
import { loadRegistry } from "@/lib/registry";

export const dynamic = "force-dynamic";

async function GETImpl() {
  const registry = await loadRegistry();
  const states = (await ensureRest())
    ? (await rest("source_state?select=*&limit=1000")).rows
    : await sql`SELECT * FROM source_state`;
  const stateMap = new Map(states.map((r) => [r.source_id, r]));
  const sources = registry.sources.map((s) => ({
    id: s.id, name: s.name, group: s.group, enabled: s.enabled,
    status: s.status, priority: s.priority,
    limits: s.limits, schedule: s.schedule,
    state: stateMap.get(s.id) ?? null,
  }));
  return NextResponse.json({ groups: registry.groups, sources });
}