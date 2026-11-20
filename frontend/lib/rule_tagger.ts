import { guessCity } from "./cities";
import { sql } from "./db/client";
import { fresherHeuristic } from "./prefilter";
import { CITIES, type City, type JobType, type Role } from "./taxonomy";

export const RULE_TAG_MODEL = "rule-v1";

export interface RuleTag {
  role: Role;
  city: City;
  job_type: JobType;
  is_fresher: boolean;
  confidence: number;
}

export interface TagInput {
  title: string;
  company?: string | null;
  locationRaw?: string | null;
  description?: string | null;
}

// Keyword evidence per role. Title hits weigh 3x description hits; description
// contribution is capped so company boilerplate cannot outvote the title.
const ROLE_KEYWORDS: Record<Exclude<Role, "other">, string[]> = {
  frontend: ["frontend", "front-end", "front end", "react", "reactjs", "react.js", "next.js", "nextjs", "vue", "angular", "svelte", "html", "css", "tailwind", "javascript", "typescript", "ui developer", "ui engineer", "web developer", "redux"],
  backend: ["backend", "back-end", "back end", "node", "nodejs", "node.js", "express", "django", "flask", "spring", "spring boot", "springboot", "laravel", "rails", "golang", "rust", "java", "php", ".net", "asp.net", "c#", "api developer", "microservices", "graphql", "postgres", "mysql", "mongodb", "rest api"],
  fullstack: ["fullstack", "full-stack", "full stack", "mern", "mean stack"],
  mobile: ["android", "ios", "flutter", "react native", "kotlin", "swift", "swiftui", "mobile developer", "mobile engineer", "xamarin", "jetpack"],
  data_analytics: ["data analyst", "business analyst", "data analytics", "business intelligence", "power bi", "powerbi", "tableau", "looker", "sql", "excel", "reporting analyst", "analytics intern"],
  data_science_ml: ["data scientist", "data science", "machine learning", "ml engineer", "ml engineering", "deep learning", "nlp", "computer vision", "tensorflow", "pytorch", "scikit", "sklearn", "pandas", "numpy", "ai engineer", "artificial intelligence", "llm", "research scientist", "statistician"],
  devops_cloud: ["devops", "sre", "site reliability", "kubernetes", "k8s", "docker", "terraform", "ansible", "aws", "azure", "gcp", "cloud engineer", "ci/cd", "cicd", "jenkins", "platform engineer", "infrastructure engineer"],
  qa_testing: ["qa", "quality assurance", "tester", "testing", "sdet", "selenium", "cypress", "playwright", "test engineer", "automation testing", "manual testing", "jest"],
  product_management: ["product manager", "product management", "product owner", "associate product", "product analyst", "roadmap"],
  design_ux: ["ui/ux", "ux", "ui designer", "product designer", "graphic designer", "figma", "sketch", "visual design", "design intern", "illustrator", "photoshop", "ux researcher", "interaction design"],
  marketing: ["marketing", "seo", "sem", "social media", "growth marketing", "growth intern", "growth analyst", "growth associate", "growth manager", "growth hacker", "performance marketing", "digital marketing", "brand", "content marketing", "email marketing", "campaigns"],
  sales_bizdev: ["sales", "business development", "bde", "bdm", "account executive", "account manager", "sales development", "sdr", "bdr", "inside sales", "field sales", "lead generation"],
  content_writing: ["content writer", "copywriter", "copywriting", "technical writer", "editor", "journalism", "content intern", "blogging", "content creator", "proofreading"],
  hr_recruiting: ["hr", "human resources", "recruiter", "recruiting", "talent acquisition", "people ops", "hr intern", "sourcing"],
  finance_accounting: ["finance", "accounting", "accountant", "audit", "tax", "financial analyst", "treasury", "chartered accountant", "accounts payable", "accounts receivable", "tally", "gst", "bookkeeping"],
  operations_supply_chain: ["operations", "supply chain", "logistics", "procurement", "operations intern", "warehouse", "inventory", "vendor management"],
  customer_support: ["customer support", "customer success", "customer service", "support engineer", "help desk", "service desk", "chat support", "client support"],
  core_engineering: ["mechanical", "civil", "electrical", "electronics", "embedded", "autocad", "solidworks", "plc", "scada", "design engineer", "production engineer", "maintenance engineer", "hvac"],
  software_engineering: ["software engineer", "software developer", "software development", "sde", "software intern", "developer intern", "engineer intern", "computer science", "programming", "graduate engineer", "engineer trainee", "member of technical staff", "mts", "application developer", "systems engineer"],
};

// Specific roles win ties against the generic software_engineering bucket.
const ROLE_ORDER = Object.keys(ROLE_KEYWORDS) as Exclude<Role, "other">[];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ROLE_RE: Record<string, RegExp> = Object.fromEntries(
  ROLE_ORDER.map((r) => [
    r,
    new RegExp(`(?<![a-z0-9])(?:${ROLE_KEYWORDS[r].map(escapeRe).join("|")})(?![a-z0-9])`, "gi"),
  ]),
);

function countMatches(re: RegExp, text: string): number {
  re.lastIndex = 0;
  let n = 0;
  while (re.exec(text)) n++;
  return n;
}

export function classifyRole(title: string, description: string): { role: Role; confidence: number } {
  const t = title.toLowerCase();
  const d = description.toLowerCase().slice(0, 6000);
  const scored = ROLE_ORDER.map((role) => {
    const re = ROLE_RE[role];
    const titleHits = countMatches(re, t);
    return { role, titleHits, score: 3 * titleHits + Math.min(countMatches(re, d), 4) };
  });
  // The title names the job. Company boilerplate ("growth", "brand", "scale")
  // must never outvote it, so description-only evidence is a fallback for
  // titles that carry no role signal at all.
  const withTitle = scored.filter((s) => s.titleHits > 0);
  const pool = withTitle.length ? withTitle : scored;
  let best: Role = "other";
  let bestScore = 0;
  let second = 0;
  for (const s of pool) {
    if (s.score > bestScore) {
      second = bestScore;
      bestScore = s.score;
      best = s.role;
    } else if (s.score > second) {
      second = s.score;
    }
  }
  if (bestScore === 0) return { role: "other", confidence: 0.4 };
  const confidence = Math.min(0.95, 0.55 + 0.07 * bestScore + (bestScore > second ? 0.1 : 0));
  return { role: best, confidence: Math.round(confidence * 100) / 100 };
}

export function classifyJobType(title: string, description: string, isFresher: boolean): JobType {
  const t = title.toLowerCase();
  const d = description.toLowerCase().slice(0, 2000);
  if (/\bapprentice(?:ship)?s?\b/.test(t) || /\bapprentice(?:ship)?s?\b/.test(d)) return "apprenticeship";
  if (/\bintern(?:s|ship|ships)?\b/.test(t) || /\bintern(?:s|ship|ships)?\b/.test(d)) return "internship";
  if (isFresher) return "fresher_fulltime";
  return "other";
}

export function classifyCity(locationRaw: string | null | undefined, description: string): City {
  const city = guessCity(locationRaw) ?? guessCity(description.slice(0, 600));
  if (city && (CITIES as readonly string[]).includes(city)) return city as City;
  return "Unknown";
}

// Deterministic, zero-cost tagger applied at ingest so every stored job is
// immediately filterable by role/city/type without waiting on an LLM run.
export function tagJob(input: TagInput): RuleTag {
  const title = input.title ?? "";
  const description = input.description ?? "";
  const is_fresher = fresherHeuristic({
    source: "", url: "", title, company: input.company ?? "",
    locationRaw: input.locationRaw, description,
  });
  const { role, confidence } = classifyRole(title, description);
  return {
    role,
    city: classifyCity(input.locationRaw, description),
    job_type: classifyJobType(title, description, is_fresher),
    is_fresher,
    confidence,
  };
}

interface UntaggedRow { id: number; title: string; company: string; location_raw: string | null; description: string | null }

// Backfill rule tags for rows ingested before rule tagging existed (or left
// pending/failed by the optional LLM pass). One set-based UPDATE per batch.
// reapply=true also re-runs the rules over rows already tagged rule-v1 (e.g.
// after a classifier accuracy fix); LLM-tagged rows are never touched.
export async function ruleTagUntagged(batchSize = 400, maxBatches = 20, reapply = false): Promise<{ tagged: number; batches: number }> {
  let tagged = 0;
  let batches = 0;
  for (let b = 0; b < maxBatches; b++) {
    const rows = (reapply
      ? await sql`
          SELECT id, title, company, location_raw, description FROM jobs
          WHERE tag_model = ${RULE_TAG_MODEL} OR tag_status <> 'done' OR role IS NULL
          ORDER BY id LIMIT ${batchSize}`
      : await sql`
          SELECT id, title, company, location_raw, description FROM jobs
          WHERE tag_status <> 'done' OR role IS NULL
          ORDER BY id LIMIT ${batchSize}`) as unknown as UntaggedRow[];
    if (!rows.length) break;
    const payload = rows.map((r) => {
      const t = tagJob({ title: r.title, company: r.company, locationRaw: r.location_raw, description: r.description });
      return { id: Number(r.id), role: t.role, city: t.city, job_type: t.job_type, is_fresher: t.is_fresher, conf: t.confidence };
    });
    await sql`
      UPDATE jobs j SET role = v.role, city = v.city, job_type = v.job_type,
        is_fresher = v.is_fresher, tag_confidence = v.conf,
        tag_status = 'done', tagged_at = now(), tag_model = ${RULE_TAG_MODEL}
      FROM jsonb_to_recordset(${sql.json(payload)})
        AS v(id bigint, role text, city text, job_type text, is_fresher boolean, conf real)
      WHERE j.id = v.id`;
    tagged += rows.length;
    batches++;
  }
  return { tagged, batches };
}