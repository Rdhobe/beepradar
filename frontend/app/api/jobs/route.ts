import { NextRequest, NextResponse } from "next/server";
import { dbGuard } from "@/lib/db/errors";
export const GET = dbGuard(GETImpl);
import { sql } from "@/lib/db/client";
import { rest, ensureRest } from "@/lib/db/rest";
import { getSupabase } from "@/lib/supabase/client";
import { CITIES, JOB_TYPES, ROLES } from "@/lib/taxonomy";
import { cleanDescription } from "@/lib/normalize";

export const dynamic = "force-dynamic";

const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 10_000) hits.clear();
  return recent.length > 120;
}

function jobDict(r: any) {
  return {
    id: Number(r.id), title: r.title, company: r.company,
    location_raw: r.location_raw, role: r.role, city: r.city,
    job_type: r.job_type, is_fresher: r.is_fresher,
    tag_status: r.tag_status, tag_confidence: r.tag_confidence,
    source: r.source, url: r.apply_url || r.canonical_url,
    posted_at: r.posted_at, first_seen_at: r.first_seen_at,
    description_snippet: cleanDescription(r.description).slice(0, 300),
  };
}

const SELECT = "id,title,company,location_raw,role,city,job_type,is_fresher,tag_status,tag_confidence,source,apply_url,canonical_url,posted_at,first_seen_at,description";

async function restJobs(page: number, pageSize: number, role: string, city: string, type: string, q: string) {
  const filters = ["is_active=eq.true", "or=(is_fresher.is.null,is_fresher.neq.false)", "tag_status=neq.failed"];
  if (role) filters.push(`role=eq.${encodeURIComponent(role)}`);
  if (city) filters.push(`city=eq.${encodeURIComponent(city)}`);
  if (type) filters.push(`job_type=eq.${encodeURIComponent(type)}`);
  if (q) filters.push(`search_tsv=wfts.${encodeURIComponent(q)}`);
  const order = "posted_at.desc.nullslast,first_seen_at.desc";
  const path = `jobs?select=${SELECT}&${filters.join("&")}&order=${order}&limit=${pageSize}&offset=${(page - 1) * pageSize}`;
  const [board, last] = await Promise.all([
    rest(path, { count: true }),
    rest("ingest_runs?select=finished_at&error=is.null&order=finished_at.desc.nullslast&limit=1"),
  ]);
  return { total: board.total ?? board.rows.length, rows: board.rows, last: last.rows[0]?.finished_at ?? null };
}

async function GETImpl(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (rateLimited(ip)) return NextResponse.json({ error: "rate limited" }, { status: 429 });

  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim().slice(0, 200);
  const role = sp.get("role") ?? "";
  const city = sp.get("city") ?? "";
  const type = sp.get("type") ?? "";

  // Anonymous visitors get a 6-post preview without application links.
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  let signedIn = false;
  if (token) {
    const sb = getSupabase();
    if (sb) signedIn = !!(await sb.auth.getUser(token)).data.user;
  }
  const page = signedIn ? Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1) : 1;
  const requested = Math.min(100, Math.max(1, parseInt(sp.get("page_size") ?? "20", 10) || 20));
  const pageSize = signedIn ? requested : Math.min(6, requested);

  let total: number, rows: any[], last: string | null;
  if (await ensureRest()) {
    const r = await restJobs(page, pageSize, role, city, type, q);
    total = r.total; rows = r.rows; last = r.last;
  } else {
    const filters = [sql`is_active = true`, sql`is_fresher IS DISTINCT FROM false`, sql`tag_status <> 'failed'`];
    if (role && (ROLES as readonly string[]).includes(role)) filters.push(sql`role = ${role}`);
    if (city && (CITIES as readonly string[]).includes(city)) filters.push(sql`city = ${city}`);
    if (type && (JOB_TYPES as readonly string[]).includes(type)) filters.push(sql`job_type = ${type}`);
    if (q) filters.push(sql`search_tsv @@ websearch_to_tsquery('english', ${q})`);
    const where = filters.reduce((a, b) => sql`${a} AND ${b}`);
    const order = q
      ? sql`ts_rank(search_tsv, websearch_to_tsquery('english', ${q})) DESC, posted_at DESC NULLS LAST`
      : sql`posted_at DESC NULLS LAST, first_seen_at DESC`;
    const [totalRows, rowRows, lastRows] = await Promise.all([
      sql`SELECT count(*)::int AS c FROM jobs WHERE ${where}`,
      sql`SELECT * FROM jobs WHERE ${where} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      sql`SELECT max(finished_at) AS t FROM ingest_runs WHERE error IS NULL`,
    ]);
    total = totalRows[0].c; rows = rowRows; last = lastRows[0].t;
  }

  return NextResponse.json({
    total, page, page_size: pageSize, preview: !signedIn,
    last_refreshed: last,
    results: rows.map((r) => {
      const d = jobDict(r);
      if (!signedIn) d.url = "";
      return d;
    }),
  });
}