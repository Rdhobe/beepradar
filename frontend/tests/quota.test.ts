import { describe, expect, it } from "vitest";
import { parseQuotas, windowKeys, QuotaTracker } from "@/lib/quota";
import { registry, sourceConfig, blocklistDomains } from "@/lib/registry";
import type { SourceConfig } from "@/lib/registry";

function fakeSource(overrides: Partial<SourceConfig>): SourceConfig {
  return {
    id: "fake", name: "Fake", group: "G3", priority: 1, enabled: true, status: "confirmed",
    api: { base_url: "https://example.com", auth: { type: "none", env: [] } },
    limits: { level: "third_party", quotas: [] },
    schedule: { cron: "0 */6 * * *", max_requests_per_run: 10 },
    ...overrides,
  };
}

describe("windowKeys", () => {
  it("produces UTC minute/hour/day/week/month keys", () => {
    const keys = windowKeys(new Date("2026-11-18T10:30:45Z"));
    expect(keys.minute).toBe("m:2026-11-18T10:30");
    expect(keys.hour).toBe("h:2026-11-18T10");
    expect(keys.day).toBe("d:2026-11-18");
    expect(keys.month).toBe("M:2026-11");
    expect(keys.week).toMatch(/^w:2026-W\d{2}$/);
  });

  it("handles ISO week year boundary (Jan 1 2027 is week 53 of 2026)", () => {
    expect(windowKeys(new Date("2027-01-01T00:00:00Z")).week).toBe("w:2026-W53");
  });
});

describe("parseQuotas", () => {
  it("applies 0.8 safety margin to third-party limits", () => {
    const s = fakeSource({ limits: { level: "third_party", quotas: [{ n: 250, per: "day" }] } });
    expect(parseQuotas(s).day).toBe(200);
  });

  it("applies 0.9 margin to official limits", () => {
    const s = fakeSource({ limits: { level: "official", quotas: [{ n: 100, per: "day" }] } });
    expect(parseQuotas(s).day).toBe(90);
  });

  it("converts per-40s etiquette limits into a minute cap", () => {
    const s = fakeSource({ limits: { level: "measured", quotas: [{ n: 8, per: "40s" }] } });
    expect(parseQuotas(s).minute).toBe(Math.floor((8 * 60) / 40 * 0.8));
  });

  it("skips concurrent/none quotas and null n", () => {
    const s = fakeSource({
      limits: { level: "official", quotas: [{ n: 2, per: "concurrent" }, { n: null, per: "day" }] },
    });
    expect(parseQuotas(s)).toEqual({});
  });

  it("daily_budget caps below quota-derived caps", () => {
    const s = fakeSource({
      limits: { level: "official", quotas: [{ n: 1000, per: "day" }] },
      schedule: { cron: "0 0 * * *", max_requests_per_run: 10, daily_budget: 50 },
    });
    expect(parseQuotas(s).day).toBe(50);
  });

  it("monthly_budget creates a month cap", () => {
    const s = fakeSource({
      schedule: { cron: "0 0 * * *", max_requests_per_run: 5, monthly_budget: 200 },
    });
    expect(parseQuotas(s).month).toBe(200);
  });
});

describe("QuotaTracker (no DB)", () => {
  it("respects budget override from 429 backoff", () => {
    const s = fakeSource({
      limits: { level: "third_party", quotas: [{ n: 250, per: "day" }] },
    });
    const t = new QuotaTracker(s, 25);
    expect(t.caps.day).toBe(25);
  });

  it("uses max_requests_per_run from schedule", () => {
    const t = new QuotaTracker(fakeSource({}));
    expect(t.maxPerRun).toBe(10);
  });
});

describe("registry integrity", () => {
  it("loads all sources with unique ids", () => {
    const ids = registry.sources.map((s) => s.id);
    expect(ids.length).toBeGreaterThan(30);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every enabled source has cron + max_requests_per_run", () => {
    for (const s of registry.sources.filter((x) => x.enabled)) {
      expect(s.schedule.cron, s.id).toBeTruthy();
      expect(s.schedule.max_requests_per_run, s.id).toBeGreaterThan(0);
    }
  });

  it("blocklist covers the assignment's forbidden sites", () => {
    const bl = blocklistDomains();
    for (const d of ["linkedin.com", "naukri.com", "indeed.com", "internshala.com", "glassdoor.com", "wellfound.com"]) {
      expect(bl).toContain(d);
    }
  });

  it("greenhouse and adzuna configs resolve", () => {
    expect(sourceConfig("greenhouse")?.api.base_url).toContain("greenhouse");
    expect(sourceConfig("adzuna_in")?.api.query_loop?.what.length).toBeGreaterThan(0);
  });
});