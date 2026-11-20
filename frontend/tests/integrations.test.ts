import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decryptSecret, encryptSecret, maskValue, masterKeyPresent, redactSecrets, withSecrets,
} from "@/lib/secrets";
import {
  autoRoot, buildHttpRequest, getPath, mapRow, suggestRoots, CustomHttpAdapter,
} from "@/lib/sources/custom_http";
import { buildCustomConfig, buildHttpApi, sanitizePatch } from "@/lib/admin/validate";
import { boardCount, categoryOf, integrationInfo, requiredKeys } from "@/lib/admin/integrations";
import type { SourceConfig } from "@/lib/registry";

const MASTER = randomBytes(32).toString("hex");

beforeEach(() => {
  process.env.SOURCE_KEYS_SECRET = MASTER;
  // fail fast instead of a 10s connect timeout when the lazy DB import runs
  process.env.DATABASE_URL ||= "postgres://u:p@127.0.0.1:1/db";
});
afterEach(() => {
  delete process.env.SOURCE_KEYS_SECRET;
});

describe("secrets crypto", () => {
  it("encrypts and decrypts roundtrip", () => {
    const cipher = encryptSecret("super-secret-key-123");
    expect(cipher.startsWith("v1:")).toBe(true);
    expect(cipher).not.toContain("super-secret-key-123");
    expect(decryptSecret(cipher)).toBe("super-secret-key-123");
  });
  it("uses a fresh IV per encryption", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });
  it("rejects tampered ciphertext (GCM auth tag)", () => {
    const cipher = encryptSecret("value");
    const parts = cipher.split(":");
    const data = Buffer.from(parts[3], "base64");
    data[0] ^= 0xff;
    parts[3] = data.toString("base64");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });
  it("rejects wrong master key", () => {
    const cipher = encryptSecret("value");
    process.env.SOURCE_KEYS_SECRET = randomBytes(32).toString("hex");
    expect(() => decryptSecret(cipher)).toThrow();
  });
  it("rejects malformed ciphertext", () => {
    expect(() => decryptSecret("garbage")).toThrow();
    expect(() => decryptSecret("v2:aaaa:bbbb:cccc")).toThrow();
  });
  it("masterKeyPresent validates format", () => {
    expect(masterKeyPresent()).toBe(true);
    process.env.SOURCE_KEYS_SECRET = "too-short";
    expect(masterKeyPresent()).toBe(false);
    delete process.env.SOURCE_KEYS_SECRET;
    expect(masterKeyPresent()).toBe(false);
    process.env.SOURCE_KEYS_SECRET = randomBytes(32).toString("base64");
    expect(masterKeyPresent()).toBe(true);
  });
  it("encrypt without master key throws", () => {
    delete process.env.SOURCE_KEYS_SECRET;
    expect(() => encryptSecret("x")).toThrow();
  });
});

describe("withSecrets", () => {
  it("injects keys and restores previous env afterwards", async () => {
    process.env.TEST_PREV = "old";
    delete process.env.TEST_NEW;
    const seen = await withSecrets({ TEST_PREV: "injected", TEST_NEW: "fresh" }, async () => ({
      prev: process.env.TEST_PREV, fresh: process.env.TEST_NEW,
    }));
    expect(seen).toEqual({ prev: "injected", fresh: "fresh" });
    expect(process.env.TEST_PREV).toBe("old");
    expect(process.env.TEST_NEW).toBeUndefined();
    delete process.env.TEST_PREV;
  });
  it("restores env even when fn throws", async () => {
    delete process.env.TEST_THROW;
    await expect(withSecrets({ TEST_THROW: "v" }, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(process.env.TEST_THROW).toBeUndefined();
  });
});

describe("redact + mask", () => {
  it("redacts secret values from text", () => {
    expect(redactSecrets("url?key=abcdef123456&x=1", ["abcdef123456"])).toBe("url?key=[REDACTED]&x=1");
  });
  it("ignores short values", () => {
    expect(redactSecrets("abc", ["abc"])).toBe("abc");
  });
  it("masks to last 4 chars", () => {
    expect(maskValue("sk-live-987654321")).toBe("••••4321");
  });
});

describe("custom_http mapping", () => {
  it("getPath walks dot paths", () => {
    expect(getPath({ a: { b: [{ c: 5 }] } }, "a.b.0.c")).toBe(5);
    expect(getPath({ a: 1 }, "a.b")).toBeUndefined();
    expect(getPath({ a: 1 }, undefined)).toBeUndefined();
  });
  it("autoRoot finds common array keys", () => {
    expect(autoRoot({ data: { jobs: [{ id: 1 }] } })).toEqual([{ id: 1 }]);
    expect(autoRoot([{ id: 2 }])).toEqual([{ id: 2 }]);
    expect(autoRoot({ nope: 1 })).toEqual([]);
  });
  it("suggestRoots reports paths, counts and sample keys", () => {
    const roots = suggestRoots({ results: { items: [{ title: "t", url: "u" }, { title: "t2" }] } });
    expect(roots).toEqual([{ path: "results.items", count: 2, sample_keys: ["title", "url"] }]);
  });
  it("mapRow requires title and url", () => {
    const fields = { title: "name", url: "link", company: "org.name", location: "city" };
    const row = mapRow({ name: "Dev", link: "https://x/1", org: { name: "Acme" }, city: "Pune" }, fields, "src");
    expect(row).toMatchObject({ source: "src", title: "Dev", url: "https://x/1", company: "Acme", locationRaw: "Pune" });
    expect(mapRow({ name: "Dev" }, fields, "src")).toBeNull();
  });
});

describe("buildHttpRequest auth", () => {
  const base = { base_url: "https://api.x/jobs", method: "GET", headers: { A: "1" }, query: { q: "dev" } };
  it("injects header auth", () => {
    const r = buildHttpRequest({ ...base, auth: { in: "header", name: "X-Key" } }, "sekret");
    expect(r.headers["X-Key"]).toBe("sekret");
  });
  it("injects bearer auth", () => {
    const r = buildHttpRequest({ ...base, auth: { in: "bearer" } }, "tok");
    expect(r.headers.Authorization).toBe("Bearer tok");
  });
  it("injects basic auth", () => {
    const r = buildHttpRequest({ ...base, auth: { in: "basic" } }, "user:pass");
    expect(r.headers.Authorization).toBe(`Basic ${Buffer.from("user:pass").toString("base64")}`);
  });
  it("injects query auth", () => {
    const r = buildHttpRequest({ ...base, auth: { in: "query", name: "api_key" } }, "k123");
    expect(r.params.api_key).toBe("k123");
  });
  it("none auth adds nothing", () => {
    const r = buildHttpRequest({ ...base, auth: { in: "none" } }, "k");
    expect(r.headers.Authorization).toBeUndefined();
    expect(Object.values(r.params)).not.toContain("k");
  });
});

describe("CustomHttpAdapter.fetch", () => {
  const source = {
    id: "test_api",
    api: {
      adapter: "custom_http", base_url: "https://api.x/jobs", method: "GET",
      auth: { type: "custom", env: [], in: "none" },
      response: { root: "data.jobs", fields: { title: "title", url: "url" }, pagination: { type: "none" } },
    },
  } as unknown as SourceConfig;

  function fakeClient(pages: unknown[]) {
    let i = 0;
    const calls: Record<string, string | number>[] = [];
    return {
      calls,
      request: async (_m: string, _u: string, opts: any) => {
        calls.push(opts.params);
        const data = pages[Math.min(i++, pages.length - 1)];
        return { ok: true, json: async () => data } as unknown as Response;
      },
    };
  }

  it("maps rows from the configured root", async () => {
    const client = fakeClient([{ data: { jobs: [{ title: "A", url: "https://a" }, { title: "B", url: "https://b" }] } }]);
    const rows = await new CustomHttpAdapter(source).fetch(client as any);
    expect(rows.map((r) => r.title)).toEqual(["A", "B"]);
  });
  it("follows page pagination", async () => {
    const pagSource = {
      ...source,
      api: { ...source.api, response: { root: "jobs", fields: { title: "t", url: "u" }, pagination: { type: "page", param: "p", start: 1, max_pages: 3 } } },
    } as unknown as SourceConfig;
    const client = fakeClient([
      { jobs: [{ t: "1", u: "https://1" }] },
      { jobs: [{ t: "2", u: "https://2" }] },
      { jobs: [] },
    ]);
    const rows = await new CustomHttpAdapter(pagSource).fetch(client as any);
    expect(rows.map((r) => r.title)).toEqual(["1", "2"]);
    expect(client.calls.map((c) => c.p)).toEqual([1, 2, 3]);
  });
  it("stops offset pagination on a short page", async () => {
    const pagSource = {
      ...source,
      api: { ...source.api, response: { root: "jobs", fields: { title: "t", url: "u" }, pagination: { type: "offset", param: "off", step: 2, max_pages: 5 } } },
    } as unknown as SourceConfig;
    const client = fakeClient([
      { jobs: [{ t: "1", u: "https://1" }, { t: "2", u: "https://2" }] },
      { jobs: [{ t: "3", u: "https://3" }] },
    ]);
    const rows = await new CustomHttpAdapter(pagSource).fetch(client as any);
    expect(rows).toHaveLength(3);
    expect(client.calls.map((c) => c.off)).toEqual([0, 2]);
  });
});

const HTTP_INPUT = {
  url: "https://api.example.com/jobs",
  method: "GET",
  auth_in: "header",
  auth_name: "X-Api-Key",
  secret: "EXAMPLE_API_KEY",
  query: { country: "in" },
  response: { root: "data.jobs", fields: { title: "title", url: "apply_url", company: "company.name" }, pagination: { type: "page", param: "page", start: 1, max_pages: 3 } },
};

describe("buildHttpApi validation", () => {
  it("builds a full api config", () => {
    const { api, error } = buildHttpApi(HTTP_INPUT);
    expect(error).toBeUndefined();
    expect(api).toMatchObject({
      base_url: "https://api.example.com/jobs",
      auth: { type: "custom", env: ["EXAMPLE_API_KEY"], in: "header", name: "X-Api-Key", secret: "EXAMPLE_API_KEY" },
      response: { root: "data.jobs", fields: { title: "title", url: "apply_url", company: "company.name" } },
    });
    expect((api!.response as any).pagination).toEqual({ type: "page", param: "page", max_pages: 3, start: 1 });
  });
  it("rejects blocklisted URLs", () => {
    expect(buildHttpApi({ ...HTTP_INPUT, url: "https://www.linkedin.com/jobs" }).error).toMatch(/blocklist/i);
    expect(buildHttpApi({ ...HTTP_INPUT, url: "https://naukri.com/api" }).error).toMatch(/blocklist/i);
  });
  it("rejects invalid URL / auth / fields / pagination", () => {
    expect(buildHttpApi({ ...HTTP_INPUT, url: "not-a-url" }).error).toBeTruthy();
    expect(buildHttpApi({ ...HTTP_INPUT, auth_in: "oauth" }).error).toBeTruthy();
    expect(buildHttpApi({ ...HTTP_INPUT, auth_name: "" }).error).toBeTruthy();
    expect(buildHttpApi({ ...HTTP_INPUT, secret: "lowercase" }).error).toBeTruthy();
    expect(buildHttpApi({ ...HTTP_INPUT, response: { fields: { title: "t" } } }).error).toBeTruthy();
    expect(buildHttpApi({ ...HTTP_INPUT, response: { ...HTTP_INPUT.response, pagination: { type: "page", max_pages: 99 } } }).error).toBeTruthy();
    expect(buildHttpApi({ ...HTTP_INPUT, headers: [1, 2] }).error).toBeTruthy();
  });
  it("keyless config needs no secret", () => {
    const { api, error } = buildHttpApi({ url: "https://api.x/jobs", response: { fields: { title: "t", url: "u" } } });
    expect(error).toBeUndefined();
    expect(api!.auth).toMatchObject({ in: "none", env: [] });
  });
});

describe("buildCustomConfig with custom_http", () => {
  const body = {
    id: "my_custom_api", name: "My Custom API", adapter: "custom_http",
    cron: "0 */6 * * *", quotas: [{ n: 60, per: "hour" }], http: HTTP_INPUT,
  };
  it("creates a config with the http api intact", () => {
    const { config, error } = buildCustomConfig(body, new Set());
    expect(error).toBeUndefined();
    expect(config!.api.adapter).toBe("custom_http");
    expect(config!.api.base_url).toBe("https://api.example.com/jobs");
    expect(config!.api.auth.env).toEqual(["EXAMPLE_API_KEY"]);
    expect((config!.api as any).response.fields.url).toBe("apply_url");
  });
  it("rejects duplicate and built-in ids", () => {
    expect(buildCustomConfig(body, new Set(["my_custom_api"])).error).toBeTruthy();
    expect(buildCustomConfig({ ...body, id: "greenhouse" }, new Set()).error).toBeTruthy();
  });
  it("propagates http validation errors", () => {
    expect(buildCustomConfig({ ...body, http: { url: "bad" } }, new Set()).error).toBeTruthy();
  });
});

describe("sanitizePatch http_config", () => {
  it("accepts a valid http_config patch", () => {
    const { patch, error } = sanitizePatch({ api: { http_config: HTTP_INPUT } });
    expect(error).toBeUndefined();
    expect((patch!.api as any).base_url).toBe("https://api.example.com/jobs");
    expect((patch!.api as any).response.fields.title).toBe("title");
  });
  it("rejects invalid http_config", () => {
    expect(sanitizePatch({ api: { http_config: { url: "https://x.com", response: {} } } }).error).toBeTruthy();
  });
});

describe("integration states", () => {
  function src(over: Partial<SourceConfig> = {}): SourceConfig {
    return {
      id: "x", name: "X", group: "G4", priority: 50, enabled: true, status: "active",
      api: { base_url: "", auth: { type: "none", env: [] } },
      limits: { level: "self_imposed", quotas: [{ n: 1, per: "day" }] },
      schedule: { cron: "0 0 * * *", max_requests_per_run: 1 },
      ...over,
    } as SourceConfig;
  }
  it("categorizes built-ins and customs", () => {
    expect(categoryOf(src({ id: "greenhouse" }), false)).toBe("ATS boards");
    expect(categoryOf(src({ id: "remotive" }), false)).toBe("Feeds");
    expect(categoryOf(src({ id: "hn_whoishiring" }), false)).toBe("Community");
    expect(categoryOf(src({ id: "jsearch" }), false)).toBe("Job APIs");
    expect(categoryOf(src({ id: "whatever" }), true)).toBe("Custom");
  });
  it("counts boards/feeds/pages", () => {
    expect(boardCount(src({ api: { base_url: "", auth: { type: "none", env: [] }, known_india_tokens: ["a", "b"], feeds: ["f"] } }))).toBe(3);
  });
  it("derives states from enabled + key presence", async () => {
    process.env.STATE_TEST_KEY = "value";
    const entries = [
      { s: src({ id: "keyless" }), custom: false },
      { s: src({ id: "keyed_ok", api: { base_url: "", auth: { type: "api_key", env: ["STATE_TEST_KEY"] } } }), custom: false },
      { s: src({ id: "keyed_missing", api: { base_url: "", auth: { type: "api_key", env: ["STATE_TEST_MISSING"] } } }), custom: false },
      { s: src({ id: "disabled", enabled: false }), custom: false },
    ];
    const info = await integrationInfo(entries);
    expect(info.get("keyless")!.state).toBe("available");
    expect(info.get("keyed_ok")!.state).toBe("connected");
    expect(info.get("keyed_missing")!.state).toBe("needs_connection");
    expect(info.get("disabled")!.state).toBe("off");
    expect(requiredKeys(entries[1].s)).toEqual(["STATE_TEST_KEY"]);
    delete process.env.STATE_TEST_KEY;
  });
});