import { NextRequest, NextResponse } from "next/server";
import { dbGuard } from "@/lib/db/errors";
export const GET = dbGuard(GETImpl);
import { sql } from "@/lib/db/client";
import { rest, ensureRest } from "@/lib/db/rest";
import { formatDescription } from "@/lib/normalize";

export const dynamic = "force-dynamic";

const COLS = "id,title,company,location_raw,role,city,job_type,is_fresher,tag_status,tag_confidence,tag_model,source,apply_url,canonical_url,posted_at,first_seen_at,description";

async function GETImpl(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = parseInt(id, 10);
  if (!Number.isInteger(jobId)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  let r: any;
  let seen: any[] = [];
  if (await ensureRest()) {
    r = (await rest(`jobs?id=eq.${jobId}&select=${COLS}`)).rows[0];
    // job_sources_seen is wire-only (holds apply URLs); skip over anon REST.
  } else {
    r = (await sql`SELECT * FROM jobs WHERE id = ${jobId}`)[0];
    if (r) seen = await sql`SELECT source, url, seen_at FROM job_sources_seen WHERE job_id = ${jobId}`;
  }
  if (!r) return NextResponse.json({ error: "job not found" }, { status: 404 });
  return NextResponse.json({
    id: Number(r.id), title: r.title, company: r.company, location_raw: r.location_raw,
    role: r.role, city: r.city, job_type: r.job_type, is_fresher: r.is_fresher,
    tag_status: r.tag_status, tag_confidence: r.tag_confidence, tag_model: r.tag_model ?? null, source: r.source,
    url: r.apply_url || r.canonical_url, posted_at: r.posted_at, first_seen_at: r.first_seen_at,
    description: formatDescription(r.description), seen_via: seen,
  });
}