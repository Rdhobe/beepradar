import { describe, expect, it } from "vitest";
import { parseTagResponse, SYSTEM_PROMPT } from "@/lib/tagger";
import { CITIES, ROLES } from "@/lib/taxonomy";

const valid = {
  results: [{ id: 1, role: "backend", city: "Bengaluru", job_type: "internship", is_fresher: true, confidence: 0.9 }],
};

describe("parseTagResponse", () => {
  it("parses clean JSON", () => {
    expect(parseTagResponse(JSON.stringify(valid)).results[0].role).toBe("backend");
  });

  it("extracts JSON wrapped in prose/fences", () => {
    const text = "Here you go:\n```json\n" + JSON.stringify(valid) + "\n```";
    expect(parseTagResponse(text).results).toHaveLength(1);
  });

  it("rejects out-of-enum role", () => {
    const bad = { results: [{ ...valid.results[0], role: "wizard" }] };
    expect(() => parseTagResponse(JSON.stringify(bad))).toThrow();
  });

  it("rejects out-of-enum city and bad confidence", () => {
    expect(() => parseTagResponse(JSON.stringify({ results: [{ ...valid.results[0], city: "Paris" }] }))).toThrow();
    expect(() => parseTagResponse(JSON.stringify({ results: [{ ...valid.results[0], confidence: 1.5 }] }))).toThrow();
  });

  it("rejects non-JSON", () => {
    expect(() => parseTagResponse("I cannot help with that")).toThrow();
  });
});

describe("SYSTEM_PROMPT", () => {
  it("lists every role and city from the taxonomy", () => {
    for (const r of ROLES) expect(SYSTEM_PROMPT).toContain(r);
    for (const c of CITIES) expect(SYSTEM_PROMPT).toContain(c);
  });
});