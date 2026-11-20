import { describe, expect, it } from "vitest";
import { NextResponse } from "next/server";
import { dbErrorResponse, dbGuard, withTimeout } from "@/lib/db/errors";

function err(code: string, message = "x") {
  return Object.assign(new Error(message), { code });
}

describe("dbErrorResponse", () => {
  it("maps DNS/connection failures to 503", async () => {
    for (const code of ["ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "CONNECT_TIMEOUT", "DB_TIMEOUT", "57014"]) {
      const res = dbErrorResponse(err(code));
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toMatch(/unreachable|timed out/i);
    }
  });

  it("maps postgres connection-exception class 08 to 503", async () => {
    const res = dbErrorResponse(err("08006", "connection failure"));
    expect(res.status).toBe(503);
  });

  it("maps message-only network errors to 503", async () => {
    const res = dbErrorResponse(new Error("getaddrinfo ENOTFOUND db.example.supabase.co"));
    expect(res.status).toBe(503);
  });

  it("maps other errors to 500 without leaking internals", async () => {
    const res = dbErrorResponse(new Error("relation jobs does not exist"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/server logs/i);
    expect(body.error).not.toMatch(/relation jobs/);
  });
});

describe("withTimeout", () => {
  it("resolves a fast promise", async () => {
    await expect(withTimeout(Promise.resolve(42), 100)).resolves.toBe(42);
  });

  it("rejects with DB_TIMEOUT when the promise is too slow", async () => {
    const slow = new Promise((r) => setTimeout(() => r(1), 200));
    await expect(withTimeout(slow, 20)).rejects.toMatchObject({ code: "DB_TIMEOUT" });
  });

  it("propagates the original rejection", async () => {
    await expect(withTimeout(Promise.reject(err("ECONNREFUSED")), 100)).rejects.toMatchObject({ code: "ECONNREFUSED" });
  });
});

describe("dbGuard", () => {
  it("passes through a successful handler response", async () => {
    const handler = dbGuard(async () => NextResponse.json({ ok: true }));
    const res = await handler();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("converts a thrown DB error into a 503 JSON response", async () => {
    const handler = dbGuard(async () => { throw err("ENOTFOUND"); });
    const res = await handler();
    expect(res.status).toBe(503);
  });

  it("bounds a hanging handler with the deadline", async () => {
    const handler = dbGuard(() => new Promise<NextResponse>(() => {}), 20);
    const res = await handler();
    expect(res.status).toBe(503);
  });

  it("disables the deadline when ms<=0 (long admin jobs)", async () => {
    const handler = dbGuard(async () => NextResponse.json({ ok: true }), 0);
    const res = await handler();
    expect(res.status).toBe(200);
  });

  it("forwards handler arguments", async () => {
    const handler = dbGuard(async (a: number, b: number) => NextResponse.json({ sum: a + b }));
    const res = await handler(2, 3);
    expect(await res.json()).toEqual({ sum: 5 });
  });
});