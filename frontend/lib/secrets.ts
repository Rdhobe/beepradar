import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { SourceConfig } from "./registry";

// Global encrypted key store (integration_secrets table). Keys are shared by
// name across sources — RAPIDAPI_KEY entered once connects JSearch + ActiveJobsDB.
// Master key lives ONLY in the SOURCE_KEYS_SECRET env var, never in the DB.
// Ciphertext format: v1:<iv_b64>:<tag_b64>:<data_b64> (AES-256-GCM).

const VERSION = "v1";
const TTL_MS = 30_000;
let cache: { at: number; keys: Record<string, string> } | null = null;

export function masterKey(): Buffer | null {
  const raw = process.env.SOURCE_KEYS_SECRET?.trim();
  if (!raw) return null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  try {
    const b = Buffer.from(raw, "base64");
    if (b.length === 32) return b;
  } catch { /* not base64 */ }
  return null;
}

export function masterKeyPresent(): boolean {
  return masterKey() !== null;
}

export function encryptSecret(plain: string): string {
  const key = masterKey();
  if (!key) throw new Error("SOURCE_KEYS_SECRET is not configured (or not 32 bytes)");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [VERSION, iv.toString("base64"), c.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function decryptSecret(cipher: string): string {
  const key = masterKey();
  if (!key) throw new Error("SOURCE_KEYS_SECRET is not configured");
  const [v, ivB, tagB, dataB] = cipher.split(":");
  if (v !== VERSION || !ivB || !tagB || !dataB) throw new Error("malformed secret ciphertext");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64"));
  d.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([d.update(Buffer.from(dataB, "base64")), d.final()]).toString("utf8");
}

export function invalidateSecretsCache(): void {
  cache = null;
}

export async function loadDbSecrets(): Promise<Record<string, string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.keys;
  const { sql } = await import("./db/client");
  const rows = await sql`SELECT key_name, ciphertext FROM integration_secrets`;
  const keys: Record<string, string> = {};
  for (const r of rows) {
    try {
      keys[r.key_name as string] = decryptSecret(r.ciphertext as string);
    } catch {
      console.error(`[secrets] ${r.key_name}: decrypt failed — wrong SOURCE_KEYS_SECRET?`);
    }
  }
  cache = { at: Date.now(), keys };
  return keys;
}

// DB first, env var fallback.
export async function resolveKeys(names: string[]): Promise<{ keys: Record<string, string>; missing: string[] }> {
  let db: Record<string, string> = {};
  try {
    db = await loadDbSecrets();
  } catch { /* DB unreachable → env-only mode */ }
  const keys: Record<string, string> = {};
  const missing: string[] = [];
  for (const n of names) {
    const v = db[n] ?? process.env[n];
    if (v) keys[n] = v;
    else missing.push(n);
  }
  return { keys, missing };
}

export async function keysPresent(source: SourceConfig): Promise<boolean> {
  const names = source.api.auth?.env ?? [];
  if (!names.length) return true;
  return (await resolveKeys(names)).missing.length === 0;
}

// Temporarily exposes resolved secrets via process.env so existing adapters
// (which read env directly) work unchanged; previous values are restored after.
export async function withSecrets<T>(keys: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(keys)) {
    prev[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

export function redactSecrets(text: string, values: string[]): string {
  let out = text;
  for (const v of values) {
    if (v && v.length >= 6) out = out.split(v).join("[REDACTED]");
  }
  return out;
}

export function maskValue(v: string): string {
  return "••••" + v.slice(-4);
}

export interface SecretStatus { set: boolean; source: "db" | "env" | null; masked: string | null }

export async function secretStatus(names: string[]): Promise<Record<string, SecretStatus>> {
  let db: Record<string, string> = {};
  try {
    db = await loadDbSecrets();
  } catch { /* env-only */ }
  const out: Record<string, SecretStatus> = {};
  for (const n of names) {
    const dbV = db[n];
    const envV = process.env[n];
    const v = dbV ?? envV;
    out[n] = v
      ? { set: true, source: dbV ? "db" : "env", masked: maskValue(v) }
      : { set: false, source: null, masked: null };
  }
  return out;
}

export async function saveSecret(name: string, value: string): Promise<void> {
  const cipher = encryptSecret(value);
  const { sql } = await import("./db/client");
  await sql`
    INSERT INTO integration_secrets (key_name, ciphertext, updated_at)
    VALUES (${name}, ${cipher}, now())
    ON CONFLICT (key_name) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, updated_at = now()`;
  invalidateSecretsCache();
}

export async function deleteSecret(name: string): Promise<void> {
  const { sql } = await import("./db/client");
  await sql`DELETE FROM integration_secrets WHERE key_name = ${name}`;
  invalidateSecretsCache();
}