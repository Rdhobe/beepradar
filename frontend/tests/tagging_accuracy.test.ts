import { describe, expect, it } from "vitest";
import { classifyRole } from "@/lib/rule_tagger";
import { formatDescription } from "@/lib/normalize";
import { estimateRequestTokens, nextSlotDelay } from "@/lib/tagger";

const BOILERPLATE =
  "Stripe is a technology company focused on economic growth and prosperity. " +
  "Our own growth is wholly contingent on the success of our customers. " +
  "We invest back into our technology at an unusual rate to grow faster. " +
  "Open markets enable greater variety and growth across the frontier.";

describe("classifyRole title priority", () => {
  it("does not let boilerplate 'growth' outvote an explicit engineering title", () => {
    expect(classifyRole("Software Engineer, New Grad", BOILERPLATE).role).toBe("software_engineering");
    expect(classifyRole("Software Engineer, Intern", BOILERPLATE).role).toBe("software_engineering");
  });

  it("keeps ML engineering titles in data_science_ml", () => {
    expect(classifyRole("SDE IV (ML Engineering)", BOILERPLATE).role).toBe("data_science_ml");
  });

  it("prefers sales over marketing for account executive titles", () => {
    expect(classifyRole("Account Executive - Startups, Grower (India)", BOILERPLATE).role).toBe("sales_bizdev");
  });

  it("still tags genuine marketing titles", () => {
    expect(classifyRole("Marketing Intern", "support the brand and campaigns").role).toBe("marketing");
  });

  it("falls back to description when the title carries no role signal", () => {
    expect(classifyRole("Management Trainee", "own seo, social media and email campaigns").role).toBe("marketing");
  });

  it("returns other with low confidence when nothing matches", () => {
    const r = classifyRole("Wizard", "nothing relevant here");
    expect(r.role).toBe("other");
    expect(r.confidence).toBe(0.4);
  });
});

describe("formatDescription", () => {
  it("emits headings, paragraphs and tight bullet lists", () => {
    const html = "<h2>About</h2><p>Hello world</p><ul><li>One</li><li>Two</li></ul>";
    expect(formatDescription(html)).toBe("## About\n\nHello world\n\n- One\n- Two");
  });

  it("does not duplicate text from nested containers", () => {
    expect(formatDescription("<div><p>A</p><p>B</p></div>")).toBe("A\n\nB");
  });

  it("drops scripts and keeps safe text", () => {
    expect(formatDescription("<script>alert(1)</script><p>safe</p>")).toBe("safe");
  });

  it("converts plain-text bullet glyphs and keeps paragraph breaks", () => {
    expect(formatDescription("Intro line\n\n• first\n• second")).toBe("Intro line\n\n- first\n- second");
  });

  it("returns empty for empty input", () => {
    expect(formatDescription(null)).toBe("");
    expect(formatDescription("   ")).toBe("");
  });
});

describe("free-tier pacing", () => {
  const limits = { rpm: 30, tpm: 8000, rpd: 1000, tpd: 200000 };
  const posts = [{ id: 1, title: "t", company: "c", location_raw: "l", description: "d".repeat(700) }];

  it("estimates a positive token budget per request", () => {
    expect(estimateRequestTokens(posts)).toBeGreaterThan(0);
  });

  it("allows a call when the window is empty", () => {
    expect(nextSlotDelay([], Date.now(), limits, 3000)).toBe(0);
  });

  it("delays when the token window would overflow", () => {
    const now = Date.now();
    const slots = [{ at: now - 1000, tokens: 6000 }];
    expect(nextSlotDelay(slots, now, limits, 3000)).toBeGreaterThan(0);
  });

  it("delays when the request-per-minute cap is hit", () => {
    const now = Date.now();
    const slots = Array.from({ length: 30 }, (_, i) => ({ at: now - i * 100, tokens: 10 }));
    expect(nextSlotDelay(slots, now, limits, 10)).toBeGreaterThan(0);
  });

  it("ignores slots older than a minute", () => {
    const now = Date.now();
    const slots = [{ at: now - 61_000, tokens: 7900 }];
    expect(nextSlotDelay(slots, now, limits, 3000)).toBe(0);
  });
});