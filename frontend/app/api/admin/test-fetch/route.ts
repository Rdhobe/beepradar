import { NextRequest, NextResponse } from "next/server";
import { dbGuard } from "@/lib/db/errors";
export const POST = dbGuard(POSTImpl, 25000);
import { requireAdmin } from "@/lib/admin/auth";
import { buildHttpApi } from "@/lib/admin/validate";
import { USER_AGENT } from "@/lib/registry";
import { resolveKeys, redactSecrets } from "@/lib/secrets";
import { buildHttpRequest, getPath, autoRoot, mapRow, suggestRoots } from "@/lib/sources/custom_http";

export const maxDuration = 30;

// One-shot preview fetch for the "Add integration" form. Never writes to the DB.
async function POSTImpl(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const withDefaults = {
    ...body,
    response: body.response ?? { fields: { title: "title", url: "url" } },
  };
  const built = buildHttpApi(withDefaults);
  if (built.error || !built.api) return NextResponse.json({ error: built.error }, { status: 400 });
  const api = built.api as Record<string, any>;

  const secretName: string | undefined = api.auth?.secret ?? api.auth?.env?.[0];
  let secretValue: string | undefined;
  if (secretName) {
    const { keys, missing } = await resolveKeys([secretName]);
    if (missing.length) {
      return NextResponse.json(
        { error: `${secretName} is not saved yet — connect the key first, then test` },
        { status: 400 },
      );
    }
    secretValue = keys[secretName];
  }
  const redactValues = secretValue ? [secretValue] : [];

  const { method, headers, params, json } = buildHttpRequest(api, secretValue);
  const u = new URL(api.base_url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));

  let resp: Response;
  try {
    resp = await fetch(u.toString(), {
      method,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json, */*", ...headers },
      body: json != null ? JSON.stringify(json) : undefined,
      signal: AbortSignal.timeout(15000),
      redirect: "follow",
    });
  } catch (e) {
    return NextResponse.json(
      { error: redactSecrets(`fetch failed: ${String(e)}`, redactValues).slice(0, 300) },
      { status: 502 },
    );
  }

  const text = await resp.text();
  const preview = redactSecrets(text.slice(0, 8000), redactValues);
  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch { /* not JSON — preview only */ }

  const response = api.response ?? {};
  const roots = data != null ? suggestRoots(data) : [];
  const rootArr = data != null ? (response.root ? getPath(data, response.root) : autoRoot(data)) : [];
  const sample = Array.isArray(rootArr)
    ? rootArr.slice(0, 3).map((item) => mapRow(item, response.fields ?? { title: "title", url: "url" }, "test")).filter(Boolean)
    : [];

  return NextResponse.json({
    status: resp.status,
    ok: resp.ok,
    content_type: resp.headers.get("content-type"),
    url: redactSecrets(u.toString(), redactValues),
    preview,
    roots,
    sample,
  });
}