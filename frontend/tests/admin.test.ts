import { describe, expect, it } from "vitest";
import { mergePatch } from "@/lib/registry";
import {
  buildCustomConfig, parseTokenLines, sanitizePatch, validateCron, validateQuotas,
} from "@/lib/admin/validate";

describe("mergePatch", () => {
  it("merges nested objects recursively", () => {
    const base = { a: 1, schedule: { cron: "0 0 * * *", max_requests_per_run: 5 }, keep: true };
    const out = mergePatch(base, { schedule: { cron: "0 */6 * * *" } });
    expect(out).toEqual({ a: 1, schedule: { cron: "0 */6 * * *", max_requests_per_run: 5 }, keep: true });
  });
  it("replaces arrays wholesale", () => {
    const out = mergePatch({ quotas: [{ n: 1, per: "day" }, { n: 2, per: "hour" }] }, { quotas: [{ n: 9, per: "month" }] });
    expect(out.quotas).toEqual([{ n: 9, per: "month" }]);
  });
  it("null/undefined patch values keep the base", () => {
    expect(mergePatch({ a: 1 }, { a: null })).toEqual({ a: 1 });
    expect(mergePatch({ a: 1 }, undefined)).toEqual({ a: 1 });
  });
  it("scalar patch replaces object base", () => {
    expect(mergePatch({ a: { b: 1 } }, { a: 5 })).toEqual({ a: 5 });
  });
});

describe("validateQuotas", () => {
  it("accepts valid rows", () => {
    const { quotas, error } = validateQuotas([{ n: 60, per: "hour" }, { n: 200, per: "day", hard: true }]);
    expect(error).toBeUndefined();
    expect(quotas).toEqual([{ n: 60, per: "hour" }, { n: 200, per: "day", hard: true }]);
  });
  it("rejects bad window, zero n, empty list", () => {
    expect(validateQuotas([{ n: 5, per: "fortnight" }]).error).toBeTruthy();
    expect(validateQuotas([{ n: 0, per: "day" }]).error).toBeTruthy();
    expect(validateQuotas([]).error).toBeTruthy();
  });
});

describe("validateCron", () => {
  it("accepts valid expressions", () => {
    expect(validateCron("0 */6 * * *")).toBeNull();
    expect(validateCron("30 3 * * 1-5")).toBeNull();
  });
  it("rejects garbage", () => {
    expect(validateCron("every 6 hours")).toBeTruthy();
    expect(validateCron("")).toBeTruthy();
  });
});

describe("parseTokenLines", () => {
  it("parses slug and slug|Company lines", () => {
    const { api, error } = parseTokenLines("aspora\natlan|Atlan Inc", "tokens");
    expect(error).toBeUndefined();
    expect(api!.known_india_tokens).toEqual(["aspora", { token: "atlan", company: "Atlan Inc" }]);
  });
  it("rejects blocklisted URLs", () => {
    const { error } = parseTokenLines("https://www.linkedin.com/jobs/view/123", "urls");
    expect(error).toMatch(/blocklisted/i);
  });
  it("caps rss feeds at 3", () => {
    const { api } = parseTokenLines("https://a.com/f\nhttps://b.com/f\nhttps://c.com/f\nhttps://d.com/f", "rss");
    expect((api!.feeds as string[]).length).toBe(3);
  });
  it("generic_json takes exactly one URL", () => {
    expect(parseTokenLines("https://a.com/jobs\nhttps://b.com/jobs", "base_url").error).toBeTruthy();
    expect(parseTokenLines("https://a.com/jobs", "base_url").api!.base_url).toBe("https://a.com/jobs");
  });
});

describe("buildCustomConfig", () => {
  const valid = {
    id: "acme_greenhouse", name: "Acme (Greenhouse)", adapter: "greenhouse",
    cron: "0 */6 * * *", quotas: [{ n: 60, per: "hour" }], token_lines: "acme",
  };
  it("builds a full config with adapter override", () => {
    const { config, error } = buildCustomConfig(valid, new Set());
    expect(error).toBeUndefined();
    expect(config!.api.adapter).toBe("greenhouse");
    expect(config!.api.known_india_tokens).toEqual(["acme"]);
    expect(config!.enabled).toBe(true);
    expect(config!.schedule.max_requests_per_run).toBe(10);
  });
  it("rejects duplicate and built-in ids", () => {
    expect(buildCustomConfig(valid, new Set(["acme_greenhouse"])).error).toMatch(/exists/);
    expect(buildCustomConfig({ ...valid, id: "greenhouse" }, new Set()).error).toBeTruthy();
  });
  it("rejects unknown adapter and bad id", () => {
    expect(buildCustomConfig({ ...valid, adapter: "linkedin_scraper" }, new Set()).error).toBeTruthy();
    expect(buildCustomConfig({ ...valid, id: "Bad ID!" }, new Set()).error).toBeTruthy();
  });
});

describe("sanitizePatch", () => {
  it("keeps whitelisted fields only", () => {
    const { patch, error } = sanitizePatch({ enabled: false, priority: 3, id: "hacked", schedule: { cron: "0 0 * * *" } });
    expect(error).toBeUndefined();
    expect(patch).toEqual({ enabled: false, priority: 3, schedule: { cron: "0 0 * * *" } });
  });
  it("rejects invalid cron and empty patch", () => {
    expect(sanitizePatch({ schedule: { cron: "nope" } }).error).toBeTruthy();
    expect(sanitizePatch({}).error).toBeTruthy();
  });
  it("validates token lines via adapter_hint", () => {
    const ok = sanitizePatch({ api: { token_lines: "acme|Acme", adapter_hint: "greenhouse" } });
    expect(ok.patch!.api).toEqual({ known_india_tokens: [{ token: "acme", company: "Acme" }] });
    const bad = sanitizePatch({ api: { token_lines: "https://naukri.com/x", adapter_hint: "jsonld_careers" } });
    expect(bad.error).toMatch(/blocklisted/i);
  });
});