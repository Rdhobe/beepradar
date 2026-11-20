import { resolveKeys, secretStatus, type SecretStatus } from "./secrets";

// Tagging is rule-first (free, at ingest). The optional paid pass can use any of
// three providers. The admin chooses mode + provider + model; the API key lives
// in the encrypted integration_secrets store (env fallback). Config persists in
// the single-row tagging_config table and degrades to env/defaults if absent.

export type Provider = "groq" | "openai" | "anthropic";
export type TagMode = "free" | "llm";

export interface ProviderInfo {
  id: Provider;
  label: string;
  keyEnv: string;
  kind: "openai" | "anthropic";
  endpoint: string;
  defaultModel: string;
  models: string[];
}

export const PROVIDERS: Record<Provider, ProviderInfo> = {
  groq: {
    id: "groq", label: "Groq", keyEnv: "GROQ_API_KEY", kind: "openai",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    defaultModel: "openai/gpt-oss-20b",
    models: ["openai/gpt-oss-20b", "openai/gpt-oss-120b", "llama-3.3-70b-versatile"],
  },
  openai: {
    id: "openai", label: "OpenAI (ChatGPT)", keyEnv: "OPENAI_API_KEY", kind: "openai",
    endpoint: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4o"],
  },
  anthropic: {
    id: "anthropic", label: "Anthropic (Claude)", keyEnv: "ANTHROPIC_API_KEY", kind: "anthropic",
    endpoint: "https://api.anthropic.com/v1/messages",
    defaultModel: "claude-haiku-5-5",
    models: ["claude-haiku-5-5", "claude-sonnet-4-5", "claude-opus-4-1"],
  },
};

export const PROVIDER_LIST: Provider[] = ["groq", "openai", "anthropic"];

export interface TaggingConfig { mode: TagMode; provider: Provider; model: string }

export const DEFAULT_CONFIG: TaggingConfig = { mode: "free", provider: "groq", model: "openai/gpt-oss-20b" };

function asMode(v: unknown): TagMode | null {
  return v === "free" || v === "llm" ? v : null;
}
function asProvider(v: unknown): Provider | null {
  return typeof v === "string" && v in PROVIDERS ? (v as Provider) : null;
}

// DB row wins; env (LLM_PROVIDER / LLM_MODEL / TAG_MODE) is the fallback; then
// built-in defaults. Never throws — a missing table or unreachable DB still
// yields a usable config so the free path keeps working.
export async function resolveTaggingConfig(): Promise<TaggingConfig> {
  const envProvider = asProvider(process.env.LLM_PROVIDER);
  const envModel = process.env.LLM_MODEL?.trim();
  let provider = envProvider ?? DEFAULT_CONFIG.provider;
  // Legacy envs set only LLM_MODEL (Anthropic-era). Infer the provider from the
  // model id so the fallback stays coherent instead of pairing Groq with Claude.
  if (!envProvider && envModel) {
    if (/^claude/i.test(envModel)) provider = "anthropic";
    else if (/^(openai\/|llama)/i.test(envModel)) provider = "groq";
    else if (/^(gpt-|o[134])/i.test(envModel)) provider = "openai";
  }
  const cfg: TaggingConfig = {
    mode: asMode(process.env.TAG_MODE) ?? DEFAULT_CONFIG.mode,
    provider,
    model: envModel || PROVIDERS[provider].defaultModel,
  };
  try {
    const { sql } = await import("./db/client");
    const rows = await sql`SELECT mode, provider, model FROM tagging_config WHERE id = 1`;
    const r = rows[0];
    if (r) {
      cfg.mode = asMode(r.mode) ?? cfg.mode;
      cfg.provider = asProvider(r.provider) ?? cfg.provider;
      if (typeof r.model === "string" && r.model.trim()) cfg.model = r.model.trim();
    }
  } catch { /* table not created yet / DB unreachable → env + defaults */ }
  return cfg;
}

export async function saveTaggingConfig(patch: Partial<TaggingConfig>): Promise<TaggingConfig> {
  const cur = await resolveTaggingConfig();
  const next: TaggingConfig = {
    mode: asMode(patch.mode) ?? cur.mode,
    provider: asProvider(patch.provider) ?? cur.provider,
    model: typeof patch.model === "string" && patch.model.trim() ? patch.model.trim().slice(0, 120) : cur.model,
  };
  const { sql } = await import("./db/client");
  await sql`
    INSERT INTO tagging_config (id, mode, provider, model, updated_at)
    VALUES (1, ${next.mode}, ${next.provider}, ${next.model}, now())
    ON CONFLICT (id) DO UPDATE SET
      mode = EXCLUDED.mode, provider = EXCLUDED.provider, model = EXCLUDED.model, updated_at = now()`;
  return next;
}

export async function providerKeyStatus(provider: Provider): Promise<SecretStatus> {
  const env = PROVIDERS[provider].keyEnv;
  return (await secretStatus([env]))[env];
}

export async function resolveProviderKey(provider: Provider): Promise<{ key: string | null; env: string }> {
  const env = PROVIDERS[provider].keyEnv;
  const { keys, missing } = await resolveKeys([env]);
  return { key: missing.length ? null : keys[env], env };
}

export interface RateLimits { rpm: number; tpm: number; rpd: number; tpd: number }

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// Groq free plan for gpt-oss-20b/120b, read off the console limits table on
// 2026-11-20: 30 RPM / 8K TPM / 1K RPD / 200K TPD. The tagger paces calls to stay
// under these; override via env if your plan is higher. Paid providers: no pace.
export function rateLimits(provider: Provider): RateLimits | null {
  if (provider !== "groq") return null;
  return {
    rpm: envInt("GROQ_RPM", 30),
    tpm: envInt("GROQ_TPM", 8000),
    rpd: envInt("GROQ_RPD", 1000),
    tpd: envInt("GROQ_TPD", 200000),
  };
}