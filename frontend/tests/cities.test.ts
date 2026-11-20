import { describe, expect, it } from "vitest";
import { detectCities, guessCity, isIndiaLocation } from "@/lib/cities";

describe("detectCities / guessCity", () => {
  it("maps aliases to canonical cities", () => {
    expect(guessCity("Bangalore, Karnataka")).toBe("Bengaluru");
    expect(guessCity("Gurugram")).toBe("Delhi_NCR");
    expect(guessCity("Navi Mumbai")).toBe("Mumbai");
    expect(guessCity("Cochin")).toBe("Kochi");
  });

  it("returns Multiple for multi-city locations", () => {
    expect(guessCity("Bengaluru / Hyderabad / Pune")).toBe("Multiple");
  });

  it("maps non-metro Indian cities to Other_India", () => {
    expect(guessCity("Coimbatore, Tamil Nadu")).toBe("Other_India");
    expect(guessCity("Indore")).toBe("Indore");
  });

  it("detects Remote_India only with India/APAC signal", () => {
    expect(guessCity("Remote (India)")).toBe("Remote_India");
    expect(guessCity("Remote - APAC")).toBe("Remote_India");
    expect(guessCity("Remote (US only)")).toBeNull();
  });

  it("falls back to Other_India for bare India", () => {
    expect(guessCity("India")).toBe("Other_India");
  });

  it("returns null for non-India locations", () => {
    expect(guessCity("San Francisco, CA")).toBeNull();
    expect(guessCity("London, UK")).toBeNull();
    expect(guessCity("")).toBeNull();
    expect(guessCity(null)).toBeNull();
  });

  it("uses word boundaries (no substring false hits)", () => {
    expect(detectCities("Punjab region")).not.toContain("Pune");
    expect(guessCity("Delhi, Texas")).toBe("Delhi_NCR"); // known tradeoff, LLM confirms later
  });
});

describe("isIndiaLocation", () => {
  it("accepts Indian city locations", () => {
    expect(isIndiaLocation("Pune, Maharashtra, India")).toBe(true);
    expect(isIndiaLocation("Bengaluru")).toBe(true);
  });

  it("accepts remote roles with India eligibility in description", () => {
    expect(isIndiaLocation("Remote", "Work from anywhere in India.")).toBe(true);
    expect(isIndiaLocation("Remote", "Must be based in the United States.")).toBe(false);
  });

  it("rejects foreign locations", () => {
    expect(isIndiaLocation("Berlin, Germany")).toBe(false);
    expect(isIndiaLocation(null, null)).toBe(false);
  });
});