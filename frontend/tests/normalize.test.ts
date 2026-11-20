import { describe, expect, it } from "vitest";
import {
  canonicalizeUrl, cleanDescription, fingerprint, normCompany, normTitle,
  parseDate, stripHtml, stripPii, MAX_DESC_CHARS,
} from "@/lib/normalize";

describe("canonicalizeUrl", () => {
  it("strips tracking params and www, sorts remaining params", () => {
    expect(
      canonicalizeUrl("https://www.Example.com/jobs/123/?utm_source=x&b=2&a=1&gclid=abc#frag")
    ).toBe("https://example.com/jobs/123?a=1&b=2");
  });

  it("strips trailing slash", () => {
    expect(canonicalizeUrl("https://example.com/jobs/")).toBe("https://example.com/jobs");
  });

  it("keeps root path", () => {
    expect(canonicalizeUrl("https://example.com")).toBe("https://example.com/");
  });

  it("returns invalid urls unchanged", () => {
    expect(canonicalizeUrl("not a url")).toBe("not a url");
    expect(canonicalizeUrl("")).toBe("");
  });

  it("same job with different utm tags canonicalizes identically", () => {
    const a = canonicalizeUrl("https://boards.greenhouse.io/stripe/jobs/1?utm_source=linkedin");
    const b = canonicalizeUrl("https://boards.greenhouse.io/stripe/jobs/1?utm_source=twitter");
    expect(a).toBe(b);
  });
});

describe("normCompany / normTitle", () => {
  it("strips legal suffixes and punctuation", () => {
    expect(normCompany("Razorpay Software Pvt. Ltd.")).toBe("razorpay");
    expect(normCompany("Acme Technologies (India)")).toBe("acme");
  });

  it("normalizes titles", () => {
    expect(normTitle("Software Engineer – Intern (SDE-1)")).toBe("software engineer intern sde 1");
  });
});

describe("fingerprint", () => {
  it("is stable across formatting differences", () => {
    const a = fingerprint("Acme Pvt Ltd", "SDE Intern", "Bengaluru");
    const b = fingerprint("acme", "sde intern", "Bengaluru");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{40}$/);
  });

  it("differs by city", () => {
    expect(fingerprint("Acme", "Intern", "Pune")).not.toBe(fingerprint("Acme", "Intern", "Mumbai"));
  });
});

describe("parseDate", () => {
  it("parses epoch seconds and milliseconds to UTC", () => {
    expect(parseDate("1700000000")).toBe("2023-11-14T22:13:20Z");
    expect(parseDate("1700000000000")).toBe("2023-11-14T22:13:20Z");
  });

  it("parses ISO strings", () => {
    expect(parseDate("2026-01-15T10:30:00+05:30")).toBe("2026-01-15T05:00:00Z");
  });

  it("parses dd-mm-yyyy without timezone shift", () => {
    expect(parseDate("15-01-2026")).toBe("2026-01-15T00:00:00Z");
  });

  it("returns null for garbage", () => {
    expect(parseDate("")).toBeNull();
    expect(parseDate(null)).toBeNull();
    expect(parseDate("yesterday-ish")).toBeNull();
  });
});

describe("stripHtml / stripPii / cleanDescription", () => {
  it("strips tags and collapses whitespace", () => {
    expect(stripHtml("<p>Hello&nbsp;<b>World</b></p>\n<p>x</p>")).toBe("Hello World x");
  });

  it("removes recruiter emails and Indian phone numbers", () => {
    const out = stripPii("Mail hr@acme.com or call +91 9876543210 / 9876543210 today");
    expect(out).not.toContain("hr@acme.com");
    expect(out).not.toContain("9876543210");
    expect(out).toContain("[email removed]");
    expect(out).toContain("[phone removed]");
  });

  it("caps description length", () => {
    const long = "word ".repeat(2000);
    expect(cleanDescription(long).length).toBeLessThanOrEqual(MAX_DESC_CHARS);
  });

  it("renders legacy greenhouse HTML as plain prose (no tags/entities)", () => {
    const html = "<h2><strong>Who we are</strong></h2> <h3><strong>About Stripe</strong></h3> <p>Stripe is a technology company focused on improving the conditions for economic growth.</p>";
    const out = cleanDescription(html);
    expect(out).not.toContain("<");
    expect(out).not.toContain("&");
    expect(out).toContain("Who we are");
    expect(out).toContain("About Stripe");
    expect(out.startsWith("Who we are")).toBe(true);
  });
});