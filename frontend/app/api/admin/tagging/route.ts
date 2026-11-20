import { NextRequest, NextResponse } from "next/server";
import { dbGuard } from "@/lib/db/errors";
export const GET = dbGuard(GETImpl);
export const POST = dbGuard(POSTImpl, 20000);
import { requireAdmin } from "@/lib/admin/auth";
import { sql } from "@/lib/db/client";
import { LLM_BATCH_SIZE } from "@/lib/registry";
import {
  PROVIDERS, PROVIDER_LIST, providerKeyStatus, resolveTaggingConfig, saveTaggingConfig,
  type Provider, type TagMode,
} from "@/lib/llm_config";
import { masterKeyPresent, saveSecret } from "@/lib/secrets";

export const dynamic = "force-dynamic";

async function configPayload() {
  const cfg = await resolveTaggingConfig();
  const key = await providerKeyStatus(cfg.provider);
  return {
    mode: cfg.mode, provider: cfg.provider, model: cfg.model, batch_size: LLM_BATCH_SIZE,
    key_env: PROVIDERS[cfg.provider].keyEnv,
    api_key_present: key.set, key_source: key.source, key_masked: key.masked,
    master_key_present: masterKeyPresent(),
  };
}

async function GETImpl(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "admin access required" }, { status: 401 });

  const counts = await sql`SELECT tag_status, count(*)::int AS n FROM jobs GROUP BY tag_status`;
  const recent = await sql`
    SELECT id, ran_at, model, batch_size, input_tokens, output_tokens, cached_input_tokens, latency_ms, ok, error
    FROM llm_runs ORDER BY id DESC LIMIT 10`;
  return NextResponse.json({
    counts: Object.fromEntries(counts.map((r) => [r.tag_status as string, r.n as number])),
    recent_runs: recent,
    config: await configPayload(),
    providers: PROVIDER_LIST.map((id) => ({
      id, label: PROVIDERS[id].label, keyEnv: PROVIDERS[id].keyEnv,
      defaultModel: PROVIDERS[id].defaultModel, models: PROVIDERS[id].models,
    })),
  });
}

async function POSTImpl(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "admin access required" }, { status: 401 });

  let body: { mode?: string; provider?: string; model?: string; api_key?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const mode = body.mode as TagMode;
  const provider = body.provider as Provider;
  if (mode !== "free" && mode !== "llm") return NextResponse.json({ error: "mode must be 'free' or 'llm'" }, { status: 400 });
  if (!(provider in PROVIDERS)) return NextResponse.json({ error: "unknown provider" }, { status: 400 });
  const model = String(body.model ?? "").trim();
  if (!model || model.length > 120) return NextResponse.json({ error: "model is required (max 120 chars)" }, { status: 400 });

  const apiKey = String(body.api_key ?? "").trim();
  if (apiKey) {
    if (!masterKeyPresent()) {
      return NextResponse.json({ error: "SOURCE_KEYS_SECRET is not configured on the server — set it (64 hex chars) before saving an API key, or use the env var instead" }, { status: 400 });
    }
    if (apiKey.length > 500) return NextResponse.json({ error: "api_key too long (max 500 chars)" }, { status: 400 });
    await saveSecret(PROVIDERS[provider].keyEnv, apiKey);
  }

  try {
    await saveTaggingConfig({ mode, provider, model });
  } catch {
    return NextResponse.json({ error: "tagging_config table is missing — run the provided SQL migration, then save again" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, config: await configPayload() });
}