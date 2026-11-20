import { describe, expect, it } from "vitest";
import { parseReadme } from "@/lib/sources/community";
import { extractJsonLd } from "@/lib/sources/jsonld";

describe("parseReadme (GitHub internship lists)", () => {
  const md = [
    "# Internships 2026",
    "",
    "| Company | Position | Location | Application/Link |",
    "|---|---|---|---|",
    "| Acme | SDE Intern | Bengaluru | [Apply](https://acme.com/jobs/1) |",
    "| ↳ | Data Intern | Pune | [Apply](https://acme.com/jobs/2) |",
    "| Globex | Analyst | Berlin | [Apply](https://globex.com/jobs/3) |",
    "| Initech | Graduate Engineer | Remote (India) | https://initech.com/jobs/4 |",
    "| NoLink Co | Intern | Mumbai | closed |",
  ].join("\n");

  it("extracts India rows and carries forward ↳ company cells", () => {
    const rows = parseReadme(md, "owner/repo");
    expect(rows).toHaveLength(3);
    expect(rows[0].company).toBe("Acme");
    expect(rows[1].company).toBe("Acme");
    expect(rows[1].title).toBe("Data Intern");
    expect(rows[2].company).toBe("Initech");
  });

  it("skips non-India rows and rows without links", () => {
    const rows = parseReadme(md, "owner/repo");
    expect(rows.find((r) => r.company === "Globex")).toBeUndefined();
    expect(rows.find((r) => r.title === "Intern" && r.company === "NoLink Co")).toBeUndefined();
  });

  it("returns empty for non-table markdown", () => {
    expect(parseReadme("just text\n- bullet", "owner/repo")).toEqual([]);
  });
});

describe("extractJsonLd", () => {
  it("extracts JobPosting from ld+json script", () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org", "@type": "JobPosting",
      title: "Software Intern", datePosted: "2026-11-01",
      hiringOrganization: { "@type": "Organization", name: "Acme" },
      jobLocation: { "@type": "Place", address: { addressLocality: "Pune", addressCountry: "IN" } },
      description: "<p>Great role</p>",
    })}</script></head><body></body></html>`;
    const rows = extractJsonLd(html, "https://acme.com/careers");
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Software Intern");
    expect(rows[0].company).toBe("Acme");
    expect(rows[0].locationRaw).toContain("Pune");
    expect(rows[0].url).toBe("https://acme.com/careers");
  });

  it("handles @graph arrays and ignores other types", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@graph": [
        { "@type": "Organization", name: "Acme" },
        { "@type": "JobPosting", title: "Trainee", url: "https://acme.com/j/9", hiringOrganization: { name: "Acme" } },
      ],
    })}</script>`;
    const rows = extractJsonLd(html, "https://acme.com/careers");
    expect(rows).toHaveLength(1);
    expect(rows[0].url).toBe("https://acme.com/j/9");
  });

  it("survives malformed JSON", () => {
    expect(extractJsonLd('<script type="application/ld+json">{broken</script>', "https://x.com")).toEqual([]);
  });
});