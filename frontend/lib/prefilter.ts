import { isIndiaLocation } from "./cities";
import { blocklistDomains } from "./registry";

export interface RawJob {
  source: string;
  sourceId?: string | null;
  url: string;
  title: string;
  company: string;
  locationRaw?: string | null;
  description?: string | null;
  postedAt?: string | null;
  // Set ONLY by adapters for paid/licensed job-data APIs whose results are
  // attributed back to the original posting. The URL is stored for link-back
  // and dedupe; BeepRadar never fetches the blocklisted site itself.
  licensedFeed?: boolean;
}

// Signals that mark a post as student / entry-level. Scanned across the title
// AND the whole description (requirements usually sit past the company boilerplate).
const FRESHER_SIGNALS = [
  "intern", "internship", "fresher", "freshers", "graduate", "trainee",
  "entry level", "entry-level", "apprentice", "apprenticeship", "associate",
  "sde 1", "sde-1", "sde i", "0-1 years", "0-2 years", "0-3 years",
  "0-1 year", "0-2 year", "0-3 year", "0 - 1", "0 - 2", "0 - 3",
  "1-2 years", "1-3 years", "2-3 years", "2-4 years", "0-4 years",
  "batch of 2024", "batch of 2025", "batch of 2026", "batch of 2027",
  "campus", "new grad", "new-grad", "recent graduate", "recent grad",
  "no experience", "no prior experience", "0 years", "passout", "pass out",
];

// Weaker signals only trusted in the title (in a description they are often boilerplate).
// Analyst / Executive / Specialist are standard India entry-level designations.
const FRESHER_TITLE_SIGNALS = [
  "junior", "jr.", "jr ", "student", "students", "final year", "pre-final",
  "pre final", "early career", "b.tech", "b.e/", "bca", "mca", "m.tech",
  "any graduate", "fresh graduate", "engineer trainee", "graduate engineer",
  "analyst", "executive", "specialist",
];

const SENIOR_TITLE_RE =
  /\b(senior|sr\.?|lead|principal|staff|manager|director|head of|vp|vice president|chief|architect)\b/i;
const EXPLICIT_JUNIOR_RE = /\b(intern|internship|trainee|apprentice|apprenticeship|fresher|graduate)\b/i;
const YEARS_RE = /(\d+)\s*(?:-\s*(\d+))?\s*\+?\s*years?\b/gi;

// Lowest years-of-experience lower bound mentioned ("0-3 years" -> 0, "5+ years" -> 5).
function minYears(text: string): number | null {
  let min: number | null = null;
  for (const m of text.matchAll(YEARS_RE)) {
    const low = parseInt(m[1], 10);
    if (Number.isFinite(low) && (min === null || low < min)) min = low;
  }
  return min;
}

const SCAM_RE =
  /registration fee|registration charges|fee to apply|apply fee|security deposit|pay (?:a |the )?(?:fee|amount|charge)|training fee|refundable deposit|whatsapp (?:us|your resume)|send (?:your )?resume (?:on|to) whatsapp/i;

export function isBlockedUrl(url: string, blocklist?: string[]): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host.startsWith("www.")) host = host.slice(4);
  for (const domain of blocklist ?? blocklistDomains()) {
    if (host === domain || host.endsWith("." + domain)) return true;
  }
  return false;
}

export function fresherHeuristic(job: RawJob): boolean {
  const title = job.title.toLowerCase();
  const desc = (job.description ?? "").toLowerCase();
  const explicitJunior = EXPLICIT_JUNIOR_RE.test(title);
  if (SENIOR_TITLE_RE.test(title) && !explicitJunior) return false;
  const titleYears = minYears(title);
  if (titleYears !== null && titleYears >= 4) return false;
  if (FRESHER_SIGNALS.some((kw) => title.includes(kw))) return true;
  if (FRESHER_TITLE_SIGNALS.some((kw) => title.includes(kw))) return true;
  const blob = desc.slice(0, 6000);
  if (!FRESHER_SIGNALS.some((kw) => blob.includes(kw))) return false;
  const descYears = minYears(blob);
  if (descYears !== null && descYears >= 4 && !explicitJunior) return false;
  return true;
}

export function prefilter(job: RawJob): { india: boolean; fresher: boolean; reject: string | null } {
  if (isBlockedUrl(job.url) && !job.licensedFeed)
    return { india: false, fresher: false, reject: "blocklisted_url" };
  if (job.description && SCAM_RE.test(job.description.slice(0, 3000)))
    return { india: false, fresher: false, reject: "scam_signal" };
  const india = isIndiaLocation(job.locationRaw, job.description);
  if (!india) return { india: false, fresher: false, reject: "not_india" };
  const fresher = fresherHeuristic(job);
  if (!fresher) return { india: true, fresher: false, reject: "not_fresher" };
  return { india: true, fresher: true, reject: null };
}