import { describe, expect, it } from "vitest";
import { classifyCity, classifyJobType, classifyRole, tagJob } from "@/lib/rule_tagger";
import { CITIES, JOB_TYPES, ROLES } from "@/lib/taxonomy";

describe("classifyRole", () => {
  it("maps clear titles to the right role", () => {
    expect(classifyRole("Frontend Engineer Intern", "").role).toBe("frontend");
    expect(classifyRole("Backend Developer (Node.js)", "").role).toBe("backend");
    expect(classifyRole("Data Scientist", "").role).toBe("data_science_ml");
    expect(classifyRole("HR Recruiter", "").role).toBe("hr_recruiting");
    expect(classifyRole("Mechanical Design Engineer", "").role).toBe("core_engineering");
    expect(classifyRole("Marketing Intern", "").role).toBe("marketing");
  });

  it("prefers a specific role over generic software_engineering on ties", () => {
    expect(classifyRole("React Developer Intern", "").role).toBe("frontend");
  });

  it("falls back to other when nothing matches", () => {
    expect(classifyRole("Barista", "").role).toBe("other");
  });

  it("uses description evidence when the title is generic", () => {
    expect(classifyRole("Engineer", "You will build Kubernetes operators and Terraform modules on AWS.").role).toBe("devops_cloud");
  });

  it("returns a bounded confidence", () => {
    for (const t of ["Frontend Intern", "Barista", "Software Engineer", "Data Analyst"]) {
      const c = classifyRole(t, "").confidence;
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });
});

describe("classifyCity / classifyJobType", () => {
  it("normalises aliases and falls back to the description", () => {
    expect(classifyCity("Bangalore, India", "")).toBe("Bengaluru");
    expect(classifyCity("Gurgaon", "")).toBe("Delhi_NCR");
    expect(classifyCity(null, "Based in Pune, India.")).toBe("Pune");
    expect(classifyCity("New York, USA", "")).toBe("Unknown");
  });

  it("detects internship / apprenticeship / fresher_fulltime", () => {
    expect(classifyJobType("Software Engineer Intern", "", true)).toBe("internship");
    expect(classifyJobType("Apprentice", "", true)).toBe("apprenticeship");
    expect(classifyJobType("Graduate Engineer", "", true)).toBe("fresher_fulltime");
    expect(classifyJobType("Barista", "", false)).toBe("other");
  });
});

describe("tagJob", () => {
  it("produces a complete, schema-valid tag at ingest", () => {
    const t = tagJob({
      title: "Software Engineer Intern",
      company: "Acme",
      locationRaw: "Bengaluru, India",
      description: "0-1 years. Build APIs.",
    });
    expect(ROLES).toContain(t.role);
    expect(CITIES).toContain(t.city);
    expect(JOB_TYPES).toContain(t.job_type);
    expect(t.city).toBe("Bengaluru");
    expect(t.job_type).toBe("internship");
    expect(t.is_fresher).toBe(true);
    expect(t.confidence).toBeGreaterThan(0);
    expect(t.confidence).toBeLessThanOrEqual(1);
  });

  it("tags a non-intern fresher full-time role", () => {
    const t = tagJob({ title: "Graduate Engineer Trainee", locationRaw: "Chennai", description: "2026 passout." });
    expect(t.job_type).toBe("fresher_fulltime");
    expect(t.is_fresher).toBe(true);
    expect(t.city).toBe("Chennai");
  });
});