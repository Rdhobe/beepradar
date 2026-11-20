import { z } from "zod";
import { guessCity } from "./cities";
import { sql } from "./db/client";
import { PROVIDERS, rateLimits, resolveProviderKey, resolveTaggingConfig, type RateLimits, type TaggingConfig } from "./llm_config";
import { LLM_BATCH_SIZE } from "./registry";
import { RULE_TAG_MODEL } from "./rule_tagger";
import { CITIES, JOB_TYPES, ROLES } from "./taxonomy";

const ROLE_DEFINITIONS: Record<string, string> = {
  software_engineering: "general software development not clearly frontend/backend/fullstack",
  frontend: "web UI work (React, HTML/CSS, browser)",
  backend: "server-side APIs, services, databases",
  fullstack: "explicitly both frontend and backend",
  mobile: "Android/iOS/Flutter/React Native apps",
  data_analytics: "SQL, dashboards, BI, business reporting",
  data_science_ml: "ML models, statistics, AI research, data science",
  devops_cloud: "infra, CI/CD, SRE, cloud platforms, kubernetes",
  qa_testing: "testing, QA automation, SDET",
  product_management: "product specs, roadmaps, PM roles",
  design_ux: "UI/UX, graphic, product design",
  marketing: "growth, SEO, social media, brand, performance marketing",
  sales_bizdev: "sales, business development, account management",
  content_writing: "copywriting, technical writing, editing, journalism",
  hr_recruiting: "HR, talent acquisition, people ops",
  finance_accounting: "accounting, audit, tax, financial analysis, treasury",
  operations_supply_chain: "ops, logistics, supply chain, procurement",
  customer_support: "support, success, service desks",
  core_engineering: "mechanical/civil/electrical/electronics engineering",
  other: "nothing above fits",
};

export const SYSTEM_PROMPT =
  "You label Indian job posts for a student career platform.\n" +
  'Return ONLY JSON: {"results":[{"id","role","city","job_type","is_fresher","confidence"}]}.\n\n' +
  "ROLE must be exactly one of:\n" +
  Object.entries(ROLE_DEFINITIONS).map(([r, d]) => `- ${r}: ${d}`).join("\n") +
  "\n\nCITY must be exactly one of: " + CITIES.join(", ") + "\n" +
  "City rules:\n" +
  "- Use the primary work location. Gurugram/Noida/Gurgaon/Delhi => Delhi_NCR. Bangalore => Bengaluru.\n" +
  "- Fully remote but India-eligible => Remote_India. Several cities listed => Multiple. Not stated => Unknown.\n" +
  "- Never guess a city that is not in the text.\n" +
  "ROLE rules:\n" +
  "- Choose by the day-to-day work, not the company's industry.\n" +
  "- If nothing fits => other.\n" +
  "job_type is one of: internship, fresher_fulltime, apprenticeship, other.\n" +
  "is_fresher = true if the post targets students/0-1 years/graduates/interns.\n" +
  "confidence = your honest 0-1 confidence in role AND city together.\n" +
  "Return one result per input id, no extras.";

const TagSchema = z.object({
  id: z.number().int(),
  role: z.enum(ROLES),
  city: z.enum(CITIES),
  job_type: z.enum(JOB_TYPES),
  is_fresher: z.boolean(),
  confidence: z.number().min(0).max(1),
});
const TagBatchSchema = z.object({ results: z.array(TagSchema) });
type TagBatch = z.infer<typeof TagBatchSchema>;

interface Post { id: number; title: string; company: string; location_raw: string; description: string }

// Provider-normalized token usage (Groq/OpenAI and Anthropic report differently).
interface Usage { input_tokens: number; output_tokens: number; cached_tokens: number }

async function logLlmRun(
  model: string,
  batchSize: number,
  usage: Usage | null,
  latencyMs: number,
  ok: boolean,
  error?: string | null,
  retryOf?: number | null,
): Promise<number> {
  const rows = await sql`
    INSERT INTO llm_runs (model, batch_size, input_tokens, output_tokens, cached_input_tokens, latency_ms, ok, retry_of, error)
    VALUES (${model}, ${batchSize}, ${usage?.input_tokens ?? 0}, ${usage?.output_tokens ?? 0},
      ${usage?.cached_tokens ?? 0}, ${latencyMs}, ${ok}, ${retryOf ?? null}, ${error ?? null})
    RETURNING id`;
  return Number(rows[0].id);
}

export function parseTagResponse(text: string): TagBatch {
  const m = text.match(/\{[\s\S]*\}/);
  return TagBatchSchema.parse(JSON.parse(m ? m[0] : text));
}

// Pure request builder (unit-testable, no network). Groq + OpenAI share the
// OpenAI-compatible chat/completions shape; Anthropic uses its messages API.
// gpt-oss reasoning models need max_completion_tokens (reasoning counts toward
// it) and run at low effort with the reasoning trace excluded from the answer.
export function buildLlmRequest(
  cfg: TaggingConfig,
  apiKey: string,
  posts: Post[],
  repairError?: string,
): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
  const p = PROVIDERS[cfg.provider];
  let userContent = JSON.stringify(posts);
  if (repairError) {
    userContent = `Your last output failed validation: ${repairError}. Return corrected JSON only.\n\n` + userContent;
  }
  if (p.kind === "anthropic") {
    return {
      url: p.endpoint,
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: {
        model: cfg.model, max_tokens: 4096, temperature: 0,
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userContent }],
      },
    };
  }
  const body: Record<string, unknown> = {
    model: cfg.model, temperature: 0, response_format: { type: "json_object" },
    messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: userContent }],
  };
  if (cfg.provider === "groq") {
    body.max_completion_tokens = 8192;
    if (/gpt-oss/i.test(cfg.model)) { body.reasoning_effort = "low"; body.include_reasoning = false; }
  } else {
    body.max_tokens = 4096;
  }
  return { url: p.endpoint, headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body };
}

export function parseProviderResponse(cfg: TaggingConfig, j: any): { text: string; usage: Usage } {
  if (PROVIDERS[cfg.provider].kind === "anthropic") {
    const text = (j.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    return { text, usage: { input_tokens: j.usage?.input_tokens ?? 0, output_tokens: j.usage?.output_tokens ?? 0, cached_tokens: j.usage?.cache_read_input_tokens ?? 0 } };
  }
  const text = j.choices?.[0]?.message?.content ?? "";
  return { text, usage: { input_tokens: j.usage?.prompt_tokens ?? 0, output_tokens: j.usage?.completion_tokens ?? 0, cached_tokens: j.usage?.prompt_tokens_details?.cached_tokens ?? 0 } };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callLlm(cfg: TaggingConfig, apiKey: string, posts: Post[], repairError?: string) {
  const { url, headers, body } = buildLlmRequest(cfg, apiKey, posts, repairError);
  const started = Date.now();
  for (let attempt = 0; ; attempt++) {
    const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    if (resp.ok) {
      const j = await resp.json();
      return { ...parseProviderResponse(cfg, j), latency: Date.now() - started };
    }
    const text = await resp.text().catch(() => "");
    // Free tiers answer 429 with a Retry-After; honour it once instead of
    // burning the batch, then surface the error if it persists.
    if (resp.status === 429 && attempt === 0) {
      const ra = Number(resp.headers.get("retry-after"));
      await sleep(Math.min(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 20_000, 45_000));
      continue;
    }
    throw new Error(`${PROVIDERS[cfg.provider].label} ${resp.status}: ${text.slice(0, 200)}`);
  }
}

// Rough token estimate (chars/4) plus per-post output + reasoning headroom.
export function estimateRequestTokens(posts: Post[]): number {
  return Math.ceil((SYSTEM_PROMPT.length + JSON.stringify(posts).length) / 4) + posts.length * 90;
}

interface CallSlot { at: number; tokens: number }
// Process-local sliding window so back-to-back admin clicks also stay in plan.
const recentCalls: CallSlot[] = [];

// ms to wait before a call of estTokens fits the last-60s RPM/TPM window.
export function nextSlotDelay(slots: CallSlot[], now: number, limits: RateLimits, estTokens: number): number {
  const win = slots.filter((s) => now - s.at < 60_000);
  const tokens = win.reduce((a, s) => a + s.tokens, 0);
  if (win.length + 1 <= limits.rpm && tokens + estTokens <= limits.tpm) return 0;
  return win.length ? Math.max(250, win[0].at + 60_000 - now) : 250;
}

export interface TagStats {
  status: string;
  tagged: number;
  failed: number;
  batches: number;
  city_mismatches: number;
}

export async function tagPending(maxBatches = 10, budgetMs = 50_000, includeRuleTagged = false): Promise<TagStats> {
  const stats: TagStats = { status: "ok", tagged: 0, failed: 0, batches: 0, city_mismatches: 0 };
  const cfg = await resolveTaggingConfig();
  const { key: apiKey } = await resolveProviderKey(cfg.provider);
  if (!apiKey) return { ...stats, status: "skipped_no_key" };
  const start = Date.now();

  const limits = rateLimits(cfg.provider);
  let dailyCalls = 0;
  let dailyTokens = 0;
  if (limits) {
    const d = await sql`
      SELECT count(*)::int AS c, coalesce(sum(input_tokens + output_tokens), 0)::int AS t
      FROM llm_runs WHERE model = ${cfg.model} AND ran_at >= date_trunc('day', now())`;
    dailyCalls = Number(d[0].c);
    dailyTokens = Number(d[0].t);
    if (dailyCalls >= limits.rpd * 0.95 || dailyTokens >= limits.tpd * 0.9) {
      return { ...stats, status: "skipped_daily_limit" };
    }
  }
  const record = (tokens: number) => {
    recentCalls.push({ at: Date.now(), tokens });
    if (limits) { dailyCalls += 1; dailyTokens += tokens; }
  };
  const invoke = async (posts: Post[], repair?: string) => {
    const est = estimateRequestTokens(posts);
    try {
      const r = await callLlm(cfg, apiKey, posts, repair);
      record(r.usage.input_tokens + r.usage.output_tokens);
      return r;
    } catch (e) {
      record(est);
      throw e;
    }
  };
  // Free-tier TPM is small; shorter descriptions keep a 10-post batch inside it.
  const descCap = cfg.provider === "groq" ? 700 : 1200;

  for (let b = 0; b < maxBatches; b++) {
    if (Date.now() - start > budgetMs - 10_000) break;
    // includeRuleTagged lets the paid pass upgrade rows the free rule tagger
    // already marked done. Once LLM-tagged, tag_model != rule-v1 so they drop
    // out of the queue — no infinite re-tagging.
    const rows = includeRuleTagged
      ? await sql`
          SELECT id, title, company, location_raw, description FROM jobs
          WHERE tag_status = 'pending' OR tag_model = ${RULE_TAG_MODEL}
          ORDER BY first_seen_at LIMIT ${LLM_BATCH_SIZE}`
      : await sql`
          SELECT id, title, company, location_raw, description FROM jobs
          WHERE tag_status = 'pending' ORDER BY first_seen_at LIMIT ${LLM_BATCH_SIZE}`;
    if (!rows.length) break;
    const posts: Post[] = rows.map((r) => ({
      id: Number(r.id), title: r.title, company: r.company,
      location_raw: r.location_raw ?? "", description: (r.description ?? "").slice(0, descCap),
    }));
    const ids = new Set(posts.map((p) => p.id));

    if (limits) {
      const est = estimateRequestTokens(posts);
      if (dailyCalls + 1 > limits.rpd || dailyTokens + est > limits.tpd) {
        stats.status = "stopped_daily_limit";
        break;
      }
      let delay = nextSlotDelay(recentCalls, Date.now(), limits, est);
      while (delay > 0 && Date.now() - start < budgetMs - 12_000) {
        await sleep(Math.min(delay, 4000));
        delay = nextSlotDelay(recentCalls, Date.now(), limits, est);
      }
      if (delay > 0) { stats.status = "stopped_rate_window"; break; }
    }

    let batch: TagBatch;
    try {
      const { text, usage, latency } = await invoke(posts);
      try {
        batch = parseTagResponse(text);
        await logLlmRun(cfg.model, posts.length, usage, latency, true);
      } catch (e) {
        const err = String(e instanceof Error ? e.message : e).slice(0, 300);
        const failedRunId = await logLlmRun(cfg.model, posts.length, usage, latency, false, err);
        const retry = await invoke(posts, err);
        try {
          batch = parseTagResponse(retry.text);
          await logLlmRun(cfg.model, posts.length, retry.usage, retry.latency, true, null, failedRunId);
        } catch (e2) {
          await logLlmRun(cfg.model, posts.length, retry.usage, retry.latency, false,
            String(e2 instanceof Error ? e2.message : e2).slice(0, 300), failedRunId);
          await sql`UPDATE jobs SET tag_status = 'failed' WHERE id IN ${sql([...ids])}`;
          stats.failed += ids.size;
          continue;
        }
      }
    } catch (e) {
      await logLlmRun(cfg.model, posts.length, null, 0, false, String(e instanceof Error ? e.message : e).slice(0, 300));
      console.error("[tagger] API error, leaving batch pending:", e);
      break;
    }

    stats.batches += 1;
    const seen = new Set<number>();
    for (const tag of batch.results) {
      if (!ids.has(tag.id) || seen.has(tag.id)) continue;
      seen.add(tag.id);
      const row = rows.find((r) => Number(r.id) === tag.id)!;
      const gaz = guessCity(row.location_raw);
      if (gaz && !["Multiple", "Other_India", "Unknown"].includes(gaz) && tag.city !== gaz) {
        stats.city_mismatches += 1;
      }
      await sql`
        UPDATE jobs SET role = ${tag.role}, city = ${tag.city}, job_type = ${tag.job_type},
          is_fresher = ${tag.is_fresher}, tag_confidence = ${tag.confidence},
          tag_status = 'done', tagged_at = now(), tag_model = ${cfg.model}
        WHERE id = ${tag.id}`;
      stats.tagged += 1;
    }
    const missing = [...ids].filter((id) => !seen.has(id));
    if (missing.length) console.log(`[tagger] ${missing.length} ids missing from batch result — left pending`);
  }
  return stats;
}