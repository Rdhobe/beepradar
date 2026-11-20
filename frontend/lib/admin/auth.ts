import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase/client";

// Admin = signed-in Supabase user whose email is in the ADMIN_EMAILS env var
// (comma-separated). The browser sends its access token as a Bearer header.
export async function requireAdmin(req: NextRequest): Promise<{ email: string } | null> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user?.email) return null;
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!admins.includes(data.user.email.toLowerCase())) return null;
  return { email: data.user.email };
}