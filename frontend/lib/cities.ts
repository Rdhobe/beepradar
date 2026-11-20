const CANONICAL_ALIASES: Record<string, string[]> = {
  Bengaluru: ["bengaluru", "bangalore", "bengaluru urban", "bangalore urban"],
  Mumbai: ["mumbai", "bombay", "navi mumbai", "thane"],
  Delhi_NCR: ["delhi", "new delhi", "gurgaon", "gurugram", "noida", "greater noida",
    "faridabad", "ghaziabad", "delhi ncr", "ncr"],
  Hyderabad: ["hyderabad", "secunderabad"],
  Pune: ["pune", "poona", "pimpri", "chinchwad"],
  Chennai: ["chennai", "madras"],
  Kolkata: ["kolkata", "calcutta"],
  Ahmedabad: ["ahmedabad", "amdavad", "gandhinagar"],
  Jaipur: ["jaipur"],
  Chandigarh: ["chandigarh", "mohali", "panchkula"],
  Kochi: ["kochi", "cochin", "ernakulam"],
  Indore: ["indore"],
};

const OTHER_INDIA_CITIES = [
  "surat", "vadodara", "lucknow", "kanpur", "nagpur", "bhopal", "patna",
  "bhubaneswar", "visakhapatnam", "vijayawada", "coimbatore", "mysuru", "mysore",
  "mangaluru", "mangalore", "thiruvananthapuram", "trivandrum", "kozhikode", "calicut",
  "goa", "panaji", "guwahati", "dehradun", "raipur", "ranchi", "ludhiana", "amritsar",
  "jalandhar", "agra", "varanasi", "meerut", "nashik", "aurangabad", "rajkot",
  "bhavnagar", "jamnagar", "udaipur", "jodhpur", "kota", "gwalior", "jabalpur",
  "warangal", "nellore", "guntur", "tirupati", "madurai", "trichy", "tiruchirappalli",
  "salem", "erode", "hubli", "hubballi", "belgaum", "belagavi", "davanagere",
  "puducherry", "pondicherry", "shimla", "jammu", "srinagar", "amravati", "solapur",
  "kolhapur", "sangli", "satara", "ratnagiri", "vasai", "virar",
  "gandhidham", "anand", "bharuch", "vapi", "valsad", "navsari", "mehsana",
];

const ALIAS_LOOKUP: [string, string][] = [];
for (const [canonical, aliases] of Object.entries(CANONICAL_ALIASES)) {
  for (const alias of [...aliases].sort((a, b) => b.length - a.length)) {
    ALIAS_LOOKUP.push([alias, canonical]);
  }
}
for (const city of [...OTHER_INDIA_CITIES].sort((a, b) => b.length - a.length)) {
  ALIAS_LOOKUP.push([city, "Other_India"]);
}

const REMOTE_RE = /\bremote\b|\bwork from home\b|\bwfh\b|\banywhere\b/i;
const INDIA_RE = /\bindia\b|\bbharat\b/i;
const APAC_RE = /\bapac\b|\basia\b|\bist\b|\basia\/kolkata\b/i;

export function detectCities(text: string | null | undefined): string[] {
  if (!text) return [];
  const low = " " + text.toLowerCase().replace(/[^a-z0-9 ]/g, " ") + " ";
  const found: string[] = [];
  for (const [alias, canonical] of ALIAS_LOOKUP) {
    if (low.includes(` ${alias} `) && !found.includes(canonical)) found.push(canonical);
  }
  return found;
}

export function guessCity(text: string | null | undefined): string | null {
  const cities = detectCities(text);
  if (cities.length > 1) return "Multiple";
  if (cities.length === 1) return cities[0];
  if (text && REMOTE_RE.test(text) && (INDIA_RE.test(text) || APAC_RE.test(text))) return "Remote_India";
  if (text && INDIA_RE.test(text)) return "Other_India";
  return null;
}

export function isIndiaLocation(locationRaw: string | null | undefined, description?: string | null): boolean {
  if (guessCity(locationRaw)) return true;
  if (locationRaw && INDIA_RE.test(locationRaw)) return true;
  if (locationRaw && REMOTE_RE.test(locationRaw)) {
    const blob = `${locationRaw} ${description ?? ""}`;
    return INDIA_RE.test(blob) || APAC_RE.test(blob);
  }
  if (description && REMOTE_RE.test(description.slice(0, 500))) {
    return INDIA_RE.test(description.slice(0, 2000));
  }
  // Some boards omit the location field entirely; trust an Indian city/country
  // named at the top of the post itself (only when no location was given, so a
  // foreign location is never overridden by boilerplate).
  if (!locationRaw || !locationRaw.trim()) {
    const head = (description ?? "").slice(0, 600);
    if (detectCities(head).length > 0) return true;
    if (INDIA_RE.test(head)) return true;
  }
  return false;
}