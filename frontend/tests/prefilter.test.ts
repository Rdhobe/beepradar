import { describe, expect, it } from "vitest";
import { fresherHeuristic, isBlockedUrl, prefilter, type RawJob } from "@/lib/prefilter";

function job(partial: Partial<RawJob>): RawJob {
  return {
    source: "test",
    url: "https://boards.greenhouse.io/acme/jobs/1",
    title: "Software Engineer Intern",
    company: "Acme",
    locationRaw: "Bengaluru, India",
    ...partial,
  };
}

describe("isBlockedUrl", () => {
  it("blocks blocklisted domains and subdomains", () => {
    expect(isBlockedUrl("https://www.linkedin.com/jobs/view/1")).toBe(true);
    expect(isBlockedUrl("https://in.indeed.com/viewjob?jk=1")).toBe(true);
    expect(isBlockedUrl("https://internshala.com/internship/x")).toBe(true);
    expect(isBlockedUrl("https://www.naukri.com/job-listings-x")).toBe(true);
  });

  it("allows ATS and other public sources", () => {
    expect(isBlockedUrl("https://boards.greenhouse.io/stripe/jobs/1")).toBe(false);
    expect(isBlockedUrl("https://jobs.lever.co/cred/abc")).toBe(false);
    expect(isBlockedUrl("not-a-url")).toBe(false);
  });
});

describe("fresherHeuristic", () => {
  it("accepts fresher signals in title", () => {
    expect(fresherHeuristic(job({ title: "SDE-1 Backend" }))).toBe(true);
    expect(fresherHeuristic(job({ title: "Graduate Trainee" }))).toBe(true);
    expect(fresherHeuristic(job({ title: "Data Analyst", description: "0-1 years experience" }))).toBe(true);
  });

  it("rejects senior titles even with fresher words in description", () => {
    expect(fresherHeuristic(job({ title: "Senior Software Engineer", description: "mentor interns" }))).toBe(false);
    expect(fresherHeuristic(job({ title: "Engineering Manager" }))).toBe(false);
    expect(fresherHeuristic(job({ title: "Backend Engineer (5+ years)" }))).toBe(false);
  });

  it("rejects roles with no fresher signal", () => {
    expect(fresherHeuristic(job({ title: "Product Designer", description: "Design things." }))).toBe(false);
  });

  it("finds fresher signals past the company boilerplate (deep description scan)", () => {
    const boilerplate = "About Acme: we build great things for customers worldwide. ".repeat(60);
    expect(fresherHeuristic(job({
      title: "Software Engineer",
      description: boilerplate + " Eligibility: 0-2 years, 2026 passout.",
    }))).toBe(true);
  });

  it("accepts 0-3 year ranges and junior / passout titles", () => {
    expect(fresherHeuristic(job({ title: "Engineer (0-3 years)" }))).toBe(true);
    expect(fresherHeuristic(job({ title: "Junior Data Analyst" }))).toBe(true);
    expect(fresherHeuristic(job({ title: "Software Engineer 2026 Passout" }))).toBe(true);
  });

  it("still rejects experienced non-senior titles", () => {
    expect(fresherHeuristic(job({
      title: "Software Engineer",
      description: "We welcome graduates. Requires 4+ years of experience.",
    }))).toBe(false);
  });
});

describe("prefilter", () => {
  it("passes a genuine India intern posting", () => {
    const r = prefilter(job({}));
    expect(r.reject).toBeNull();
    expect(r.india).toBe(true);
    expect(r.fresher).toBe(true);
  });

  it("rejects blocklisted urls first", () => {
    expect(prefilter(job({ url: "https://linkedin.com/jobs/1" })).reject).toBe("blocklisted_url");
  });

  it("rejects fee-based scam posts", () => {
    const r = prefilter(job({ description: "Pay a registration fee of Rs 500 to apply." }));
    expect(r.reject).toBe("scam_signal");
  });

  it("rejects non-India locations", () => {
    expect(prefilter(job({ locationRaw: "New York, USA" })).reject).toBe("not_india");
  });

  it("rejects India non-fresher roles", () => {
    expect(prefilter(job({ title: "Staff Engineer" })).reject).toBe("not_fresher");
  });

  it("accepts India posts whose location field is empty but description names an Indian city", () => {
    const r = prefilter(job({ locationRaw: null, description: "Location: Bengaluru. We are hiring interns." }));
    expect(r.reject).toBeNull();
    expect(r.india).toBe(true);
  });

  it("does not let description boilerplate override a foreign location", () => {
    expect(prefilter(job({
      locationRaw: "New York, USA",
      description: "We also have offices in Bengaluru, India.",
    })).reject).toBe("not_india");
  });
});