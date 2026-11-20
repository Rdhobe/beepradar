import { LLM_MODEL } from "./registry";
import type { Provider } from "./llm_config";

// Unit economics for the pipeline. Fetching from public ATS boards is free;
// rule tagging at ingest costs nothing. The only variable money cost is the
// optional LLM tagger, billed per token. Prices below are published list rates
// (Groq / OpenAI / Anthropic) in USD per 1M tokens and are only a default
// estimate — override them with your real contract rate via env so the
// dashboard shows true spend.
export interface ModelPrice {
  label: string;
  input_per_m: number;
  output_per_m: number;
  cache_read_per_m: number;
}

const FAMILY_PRICES: { match: RegExp; price: ModelPrice }[] = [
  { match: /opus/i, price: { label: "Claude Opus · list", input_per_m: 15, output_per_m: 75, cache_read_per_m: 1.5 } },
  { match: /sonnet/i, price: { label: "Claude Sonnet · list", input_per_m: 3, output_per_m: 15, cache_read_per_m: 0.3 } },
  { match: /haiku/i, price: { label: "Claude Haiku · list", input_per_m: 0.8, output_per_m: 4, cache_read_per_m: 0.08 } },
];
const DEFAULT_PRICE: ModelPrice = { label: "Haiku-class estimate", input_per_m: 0.8, output_per_m: 4, cache_read_per_m: 0.08 };

// Published list rates (USD per 1M tokens) per provider. Only consulted when a
// provider is passed; the legacy single-arg call keeps the Anthropic family
// fallback so existing behaviour/tests are unchanged. Groq has no cache discount.
const PROVIDER_PRICES: Record<Provider, { match: RegExp; price: ModelPrice }[]> = {
  groq: [
    { match: /gpt-oss-20b/i, price: { label: "Groq gpt-oss-20b · list", input_per_m: 0.075, output_per_m: 0.3, cache_read_per_m: 0 } },
    { match: /gpt-oss-120b/i, price: { label: "Groq gpt-oss-120b · list", input_per_m: 0.15, output_per_m: 0.6, cache_read_per_m: 0 } },
    { match: /llama-3\.3-70b/i, price: { label: "Groq Llama-3.3-70B · list", input_per_m: 0.59, output_per_m: 0.79, cache_read_per_m: 0 } },
  ],
  openai: [
    { match: /gpt-4o-mini/i, price: { label: "OpenAI gpt-4o-mini · list", input_per_m: 0.15, output_per_m: 0.6, cache_read_per_m: 0.075 } },
    { match: /gpt-4\.1-mini/i, price: { label: "OpenAI gpt-4.1-mini · list", input_per_m: 0.4, output_per_m: 1.6, cache_read_per_m: 0.1 } },
    { match: /gpt-4o/i, price: { label: "OpenAI gpt-4o · list", input_per_m: 2.5, output_per_m: 10, cache_read_per_m: 1.25 } },
  ],
  anthropic: FAMILY_PRICES,
};

export type PriceSource = "env" | "table" | "default";

function envNum(v: string | undefined): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function resolvePrice(model: string = LLM_MODEL, provider?: Provider): ModelPrice & { source: PriceSource } {
  const envIn = envNum(process.env.LLM_INPUT_PRICE_PER_M);
  const envOut = envNum(process.env.LLM_OUTPUT_PRICE_PER_M);
  const envCache = envNum(process.env.LLM_CACHE_READ_PRICE_PER_M);
  const table = provider ? PROVIDER_PRICES[provider] : FAMILY_PRICES;
  const fam = table.find((f) => f.match.test(model));
  const base = fam?.price ?? DEFAULT_PRICE;
  const source: PriceSource =
    envIn != null || envOut != null || envCache != null ? "env" : fam ? "table" : "default";
  return {
    label: base.label,
    input_per_m: envIn ?? base.input_per_m,
    output_per_m: envOut ?? base.output_per_m,
    cache_read_per_m: envCache ?? base.cache_read_per_m,
    source,
  };
}

export interface TokenTotals {
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
}

// Anthropic bills non-cached input at the input rate and cache reads at the
// cheaper read rate; output is separate. Cache writes are not tracked in
// llm_runs, so this is a slight under-count of true spend, never an over-count.
export function llmCostUsd(t: TokenTotals, p: ModelPrice): { input: number; output: number; cache: number; total: number } {
  const input = (t.input_tokens / 1e6) * p.input_per_m;
  const output = (t.output_tokens / 1e6) * p.output_per_m;
  const cache = (t.cached_tokens / 1e6) * p.cache_read_per_m;
  return { input, output, cache, total: input + output + cache };
}

export function costPer1000(totalUsd: number, posts: number): number {
  return posts > 0 ? (totalUsd / posts) * 1000 : 0;
}

// The provider bills in USD; the dashboard reports in INR. This is the display
// exchange rate, not a live FX feed — override it with USD_INR_RATE.
export const DEFAULT_USD_INR = 84;
export function inrRate(): number {
  const n = Number(process.env.USD_INR_RATE);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_USD_INR;
}

export function round(n: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}