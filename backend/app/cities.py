import re

CANONICAL_ALIASES: dict[str, list[str]] = {
    "Bengaluru": ["bengaluru", "bangalore", "bengaluru urban", "bangalore urban"],
    "Mumbai": ["mumbai", "bombay", "navi mumbai", "thane"],
    "Delhi_NCR": ["delhi", "new delhi", "gurgaon", "gurugram", "noida", "greater noida",
                  "faridabad", "ghaziabad", "delhi ncr", "ncr"],
    "Hyderabad": ["hyderabad", "secunderabad"],
    "Pune": ["pune", "poona", "pimpri", "chinchwad"],
    "Chennai": ["chennai", "madras"],
    "Kolkata": ["kolkata", "calcutta"],
    "Ahmedabad": ["ahmedabad", "amdavad", "gandhinagar"],
    "Jaipur": ["jaipur"],
    "Chandigarh": ["chandigarh", "mohali", "panchkula"],
    "Kochi": ["kochi", "cochin", "ernakulam"],
    "Indore": ["indore"],
}

OTHER_INDIA_CITIES = [
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
    "palanpur", "himmatnagar", "modasa", "godhra", "dahod", "nadiad",
]

_ALIAS_LOOKUP: list[tuple[str, str]] = []
for canonical, aliases in CANONICAL_ALIASES.items():
    for alias in sorted(aliases, key=len, reverse=True):
        _ALIAS_LOOKUP.append((alias, canonical))
for city in sorted(OTHER_INDIA_CITIES, key=len, reverse=True):
    _ALIAS_LOOKUP.append((city, "Other_India"))

_REMOTE_RE = re.compile(r"\bremote\b|\bwork from home\b|\bwfh\b|\banywhere\b", re.I)
_INDIA_RE = re.compile(r"\bindia\b|\b(in)\b(?=\s*$)|\bbharat\b", re.I)
_APAC_RE = re.compile(r"\bapac\b|\basia\b|\bist\b|\b(india|asia/kolkata)\b", re.I)


def detect_cities(text: str | None) -> list[str]:
    if not text:
        return []
    low = " " + re.sub(r"[^a-z0-9 ]", " ", text.lower()) + " "
    found: list[str] = []
    for alias, canonical in _ALIAS_LOOKUP:
        if f" {alias} " in low and canonical not in found:
            found.append(canonical)
    return found


def guess_city(text: str | None) -> str | None:
    cities = detect_cities(text)
    if len(cities) > 1:
        return "Multiple"
    if cities:
        return cities[0]
    if text and _REMOTE_RE.search(text) and (_INDIA_RE.search(text) or _APAC_RE.search(text)):
        return "Remote_India"
    if text and _INDIA_RE.search(text):
        return "Other_India"
    return None


def is_india_location(location_raw: str | None, description: str | None = None) -> bool:
    if guess_city(location_raw):
        return True
    if location_raw and _INDIA_RE.search(location_raw):
        return True
    if location_raw and _REMOTE_RE.search(location_raw):
        blob = f"{location_raw} {description or ''}"
        return bool(_INDIA_RE.search(blob) or _APAC_RE.search(blob))
    if description and _REMOTE_RE.search(description[:500]):
        return bool(_INDIA_RE.search(description[:2000]))
    return False