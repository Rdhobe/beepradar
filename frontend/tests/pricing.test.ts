import { afterEach, describe, expect, it } from "vitest";
import { costPer1000, DEFAULT_USD_INR, inrRate, llmCostUsd, resolvePrice, round } from "@/lib/pricing";

afterEach(() => {
  delete process.env.LLM_INPUT_PRICE_PER_M;
  delete process.env.LLM_OUTPUT_PRICE_PER_M;
  delete process.env.LLM_CACHE_READ_PRICE_PER_M;
  delete process.env.USD_INR_RATE;
});

describe("resolvePrice", () => {
  it("detects the haiku family for the project default model", () => {
    const p = resolvePrice("claude-haiku-5-5");
    expect(p.input_per_m).toBe(0.8);
    expect(p.output_per_m).toBe(4);
    expect(p.cache_read_per_m).toBe(0.08);
    expect(p.source).toBe("table");
  });

  it("detects sonnet and opus families", () => {
    expect(resolvePrice("claude-sonnet-4-5").output_per_m).toBe(15);
    expect(resolvePrice("claude-opus-4-1").input_per_m).toBe(15);
  });

  it("falls back to a labelled estimate for unknown models", () => {
    const p = resolvePrice("gpt-4o-mini");
    expect(p.source).toBe("default");
    expect(p.input_per_m).toBe(0.8);
  });

  it("lets env override the list rate and marks the source", () => {
    process.env.LLM_INPUT_PRICE_PER_M = "2";
    process.env.LLM_OUTPUT_PRICE_PER_M = "10";
    const p = resolvePrice("claude-3-5-haiku");
    expect(p.input_per_m).toBe(2);
    expect(p.output_per_m).toBe(10);
    expect(p.cache_read_per_m).toBe(0.08);
    expect(p.source).toBe("env");
  });

  it("ignores invalid env values", () => {
    process.env.LLM_INPUT_PRICE_PER_M = "abc";
    expect(resolvePrice("claude-3-5-haiku").input_per_m).toBe(0.8);
  });
});

describe("llmCostUsd", () => {
  it("bills input, output and cache reads at their own rates", () => {
    const price = { label: "x", input_per_m: 0.8, output_per_m: 4, cache_read_per_m: 0.08 };
    const c = llmCostUsd({ input_tokens: 1_000_000, output_tokens: 1_000_000, cached_tokens: 1_000_000 }, price);
    expect(c.input).toBeCloseTo(0.8, 6);
    expect(c.output).toBeCloseTo(4, 6);
    expect(c.cache).toBeCloseTo(0.08, 6);
    expect(c.total).toBeCloseTo(4.88, 6);
  });

  it("is zero for no tokens", () => {
    const price = resolvePrice("claude-3-5-haiku");
    expect(llmCostUsd({ input_tokens: 0, output_tokens: 0, cached_tokens: 0 }, price).total).toBe(0);
  });
});

describe("costPer1000", () => {
  it("scales total spend to a per-1000 rate", () => {
    expect(costPer1000(4.88, 1000)).toBeCloseTo(4.88, 6);
    expect(costPer1000(10, 5000)).toBeCloseTo(2, 6);
  });
  it("returns 0 when there are no posts", () => {
    expect(costPer1000(4.88, 0)).toBe(0);
  });
});

describe("round", () => {
  it("rounds to the requested precision", () => {
    expect(round(1.23456789, 4)).toBe(1.2346);
    expect(round(2.5, 0)).toBe(3);
  });
});

describe("inrRate", () => {
  it("defaults to the published display rate", () => {
    expect(inrRate()).toBe(DEFAULT_USD_INR);
  });
  it("honours a valid USD_INR_RATE override", () => {
    process.env.USD_INR_RATE = "90";
    expect(inrRate()).toBe(90);
  });
  it("ignores non-positive or invalid overrides", () => {
    process.env.USD_INR_RATE = "0";
    expect(inrRate()).toBe(DEFAULT_USD_INR);
    process.env.USD_INR_RATE = "abc";
    expect(inrRate()).toBe(DEFAULT_USD_INR);
  });
  it("converts a per-1000 USD cost to INR consistently", () => {
    process.env.USD_INR_RATE = "84";
    const spend = llmCostUsd({ input_tokens: 900_000, output_tokens: 120_000, cached_tokens: 0 }, resolvePrice("claude-3-5-haiku"));
    const usdPer1000 = costPer1000(spend.total, 1000);
    expect(round(usdPer1000 * inrRate(), 2)).toBe(100.8);
  });
});