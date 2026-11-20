import { NextResponse } from "next/server";
import { sql } from "@/lib/db/client";
import { dbGuard } from "@/lib/db/errors";
import { rest, ensureRest } from "@/lib/db/rest";
import { CITIES, JOB_TYPES, ROLES } from "@/lib/taxonomy";

export const dynamic = "force-dynamic";
export const GET = dbGuard(GETImpl);

const countOf = (filter: string) =>
  rest(`jobs?select=id&limit=1${filter ? "&" + filter : ""}`, { count: true }).then((r) => r.total ?? 0);
const distinct = (col: string) =>
  rest(`jobs?select=${col}&${col}=not.is.null&is_active=eq.true&limit=5000`).then((r) =>
    [...new Set(r.rows.map((x) => x[col]))].sort(),
  );

async function GETImpl() {
  if (await ensureRest()) {
    const [total, active, tagged, pending, failed, last, cities, roles] = await Promise.all([
      countOf(""),
      countOf("is_active=eq.true"),
      countOf("tag_status=eq.done"),
      countOf("tag_status=eq.pending"),
      countOf("tag_status=eq.failed"),
      rest("ingest_runs?select=finished_at&error=is.null&order=finished_at.desc.nullslast&limit=1"),
      distinct("city"),
      distinct("role"),
    ]);
    return NextResponse.json({
      roles: ROLES, cities: CITIES, job_types: JOB_TYPES,
      available_cities: cities, available_roles: roles,
      counts: { total, active, tagged, pending, failed },
      last_refreshed: last.rows[0]?.finished_at ?? null,
    });
  }

  const [counts, last, cities, roles] = await Promise.all([
    sql`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE is_active)::int AS active,
        count(*) FILTER (WHERE tag_status = 'done')::int AS tagged,
        count(*) FILTER (WHERE tag_status = 'pending')::int AS pending,
        count(*) FILTER (WHERE tag_status = 'failed')::int AS failed
        FROM jobs`,
    sql`SELECT max(finished_at) AS t FROM ingest_runs WHERE error IS NULL`,
    sql`SELECT DISTINCT city FROM jobs WHERE city IS NOT NULL AND is_active = true ORDER BY city`,
    sql`SELECT DISTINCT role FROM jobs WHERE role IS NOT NULL AND is_active = true ORDER BY role`,
  ]);
  return NextResponse.json({
    roles: ROLES, cities: CITIES, job_types: JOB_TYPES,
    available_cities: cities.map((r) => r.city),
    available_roles: roles.map((r) => r.role),
    counts: counts[0], last_refreshed: last[0].t,
  });
}