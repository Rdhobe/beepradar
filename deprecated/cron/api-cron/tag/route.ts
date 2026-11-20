import { NextRequest, NextResponse } from "next/server";
import { tagPending } from "@/lib/tagger";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await tagPending(10, 50_000);
  return NextResponse.json(result);
}