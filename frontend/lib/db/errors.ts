import { NextResponse } from "next/server";

const CONN_CODES = new Set([
  "ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "EPIPE",
  "EHOSTUNREACH", "ENETUNREACH", "CONNECT_TIMEOUT", "DB_TIMEOUT",
  "57014", "53300", "53400",
]);

export function dbErrorResponse(e: unknown): NextResponse {
  const code = String((e as { code?: string })?.code ?? "");
  const msg = e instanceof Error ? e.message : String(e);
  const unreachable =
    CONN_CODES.has(code) ||
    code.startsWith("08") ||
    /getaddrinfo|ENOTFOUND|ECONNREFUSED|connect|timeout|timed out/i.test(msg);
  console.error("[db]", code || "(no code)", msg);
  return NextResponse.json(
    {
      error: unreachable
        ? "Database unreachable or timed out — check DATABASE_URL (use the Supabase transaction pooler) and restart the dev server."
        : "Database error — see server logs for details.",
    },
    { status: unreachable ? 503 : 500 },
  );
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  p.catch(() => {});
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(Object.assign(new Error("database query timed out"), { code: "DB_TIMEOUT" })),
      ms,
    );
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

// Wraps a route handler: bounds DB wait (ms<=0 disables the deadline for long
// admin jobs) and converts thrown DB/network errors into clean JSON responses.
export function dbGuard<A extends unknown[]>(
  handler: (...args: A) => Promise<NextResponse>,
  ms = 15000,
) {
  return async (...args: A): Promise<NextResponse> => {
    try {
      return ms > 0 ? await withTimeout(handler(...args), ms) : await handler(...args);
    } catch (e) {
      return dbErrorResponse(e);
    }
  };
}