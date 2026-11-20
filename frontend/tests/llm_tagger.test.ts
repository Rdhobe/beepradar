import { describe, expect, it } from "vitest";
import { buildLlmRequest, parseProviderResponse } from "@/lib/tagger";
import { resolvePrice } from "@/lib/pricing";
import { DEFAULT_CONFIG, PROVIDERS } from "@/lib/llm_config";
import type { TaggingConfig } from "@/lib/llm_config";

const posts = [{ id: 1, title: "Backend Intern", company: "Acme", location_raw: "Bengaluru", description: "node api" }];
const cfg = (provider: TaggingConfig["provider"], model: string): TaggingConfig => ({ mode: "llm", provider, model });

describe("buildLlmRequest", () => {
  it("builds a Groq gpt-oss request with reasoning controls + JSON mode", () => {
    const r = buildLlmRequest(cfg("groq", "openai/gpt-oss-20b"), "KEY", posts);
    expect(r.url).toBe(PROVIDERS.groq.endpoint);
    expect(r.headers.Authorization).toBe("Bearer KEY");
    expect(r.body.max_completion_tokens).toBe(8192);
    expect(r.body.reasoning_effort).toBe("low");
    expect(r.body.include_reasoning).toBe(false);
    expect(r.body.response_format).toEqual({ type: "json_object" });
    expect((r.body.messages as any[])[0].role).toBe("system");
  });

  it("omits reasoning params for non-oss Groq models", () => {
    const r = buildLlmRequest(cfg("groq", "llama-3.3-70b-versatile"), "KEY", posts);
    expect(r.body.max_completion_tokens).toBe(8192);
    expect(r.body.reasoning_effort).toBeUndefined();
    expect(r.body.include_reasoning).toBeUndefined();
  });

  it("builds an OpenAI request with max_tokens and no reasoning params", () => {
    const r = buildLlmRequest(cfg("openai", "gpt-4o-mini"), "KEY", posts);
    expect(r.url).toBe(PROVIDERS.openai.endpoint);
    expect(r.body.max_tokens).toBe(4096);
    expect(r.body.max_completion_tokens).toBeUndefined();
    expect(r.body.reasoning_effort).toBeUndefined();
    expect(r.body.response_format).toEqual({ type: "json_object" });
  });

  it("builds an Anthropic messages request with cached system prompt", () => {
    const r = buildLlmRequest(cfg("anthropic", "claude-haiku-5-5"), "KEY", posts);
    expect(r.url).toBe(PROVIDERS.anthropic.endpoint);
    expect(r.headers["x-api-key"]).toBe("KEY");
    expect(r.headers["anthropic-version"]).toBe("2023-06-01");
    expect(r.body.max_tokens).toBe(4096);
    expect((r.body.system as any[])[0].cache_control).toEqual({ type: "ephemeral" });
    expect((r.body.messages as any[])[0].role).toBe("user");
  });

  it("prefixes the user content with the repair error", () => {
    const r = buildLlmRequest(cfg("groq", "openai/gpt-oss-20b"), "KEY", posts, "bad role");
    const user = (r.body.messages as any[]).find((m) => m.role === "user");
    expect(user.content).toContain("bad role");
    expect(user.content).toContain("Backend Intern");
  });
});

describe("parseProviderResponse", () => {
  it("maps OpenAI-compatible usage (Groq/OpenAI)", () => {
    const j = { choices: [{ message: { content: '{"results":[]}' } }], usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 5 } } };
    const out = parseProviderResponse(cfg("groq", "openai/gpt-oss-20b"), j);
    expect(out.text).toBe('{"results":[]}');
    expect(out.usage).toEqual({ input_tokens: 100, output_tokens: 20, cached_tokens: 5 });
  });

  it("maps Anthropic usage and joins text blocks", () => {
    const j = { content: [{ type: "text", text: '{"results":' }, { type: "text", text: "[]}" }], usage: { input_tokens: 80, output_tokens: 10, cache_read_input_tokens: 30 } };
    const out = parseProviderResponse(cfg("anthropic", "claude-haiku-5-5"), j);
    expect(out.text).toBe('{"results":[]}');
    expect(out.usage).toEqual({ input_tokens: 80, output_tokens: 10, cached_tokens: 30 });
  });

  it("tolerates missing usage fields", () => {
    const out = parseProviderResponse(cfg("openai", "gpt-4o-mini"), { choices: [{ message: { content: "x" } }] });
    expect(out.usage).toEqual({ input_tokens: 0, output_tokens: 0, cached_tokens: 0 });
  });
});

describe("provider-aware resolvePrice", () => {
  it("prices Groq gpt-oss-20b from the list table", () => {
    const p = resolvePrice("openai/gpt-oss-20b", "groq");
    expect(p.input_per_m).toBe(0.075);
    expect(p.output_per_m).toBe(0.3);
    expect(p.source).toBe("table");
  });

  it("prices OpenAI gpt-4o-mini and gpt-4o distinctly", () => {
    expect(resolvePrice("gpt-4o-mini", "openai").input_per_m).toBe(0.15);
    expect(resolvePrice("gpt-4o", "openai").input_per_m).toBe(2.5);
  });

  it("keeps the Anthropic family rates when provider is anthropic", () => {
    expect(resolvePrice("claude-haiku-5-5", "anthropic").output_per_m).toBe(4);
  });

  it("legacy single-arg call still falls back to the estimate for gpt-4o-mini", () => {
    expect(resolvePrice("gpt-4o-mini").source).toBe("default");
  });
});

describe("config defaults", () => {
  it("defaults to free rules with Groq gpt-oss-20b as the paid default", () => {
    expect(DEFAULT_CONFIG.mode).toBe("free");
    expect(DEFAULT_CONFIG.provider).toBe("groq");
    expect(PROVIDERS.groq.defaultModel).toBe("openai/gpt-oss-20b");
    expect(PROVIDERS.groq.keyEnv).toBe("GROQ_API_KEY");
    expect(PROVIDERS.openai.keyEnv).toBe("OPENAI_API_KEY");
    expect(PROVIDERS.anthropic.keyEnv).toBe("ANTHROPIC_API_KEY");
  });
});