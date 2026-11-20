import { createHash } from "node:crypto";
import * as cheerio from "cheerio";

const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
  "gclid", "fbclid", "msclkid", "mc_cid", "mc_eid", "ref", "ref_src", "ref_url",
  "source", "trk", "trkcampaign", "trackingid", "origin", "spm", "igshid",
]);

const LEGAL_SUFFIXES =
  /\b(pvt|private)\s*(ltd|limited)?\b|\b(ltd|limited|inc|incorporated|llp|llc|corp|corporation|co|company)\b|\b(technologies|technology|solutions|software|labs|innovations|global|india)\b/gi;

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(?<!\d)(?:\+91[\s-]?)?[6-9]\d{9}(?!\d)/g;

export const MAX_DESC_CHARS = 4000;

export function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  if (!html.includes("<") && !html.includes("&")) return html.replace(/\s+/g, " ").trim();
  const text = cheerio.load(html).text();
  return text.replace(/\s+/g, " ").trim();
}

export function stripPii(text: string): string {
  return text.replace(EMAIL_RE, "[email removed]").replace(PHONE_RE, "[phone removed]");
}

export function canonicalizeUrl(url: string): string {
  url = (url ?? "").trim();
  if (!url) return "";
  try {
    const u = new URL(url);
    const scheme = u.protocol.replace(":", "").toLowerCase();
    let host = u.hostname.toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
    const params: [string, string][] = [];
    u.searchParams.forEach((v, k) => {
      if (!TRACKING_PARAMS.has(k.toLowerCase()) && !k.toLowerCase().startsWith("utm_")) params.push([k, v]);
    });
    params.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
    const query = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${scheme}://${host}${u.port ? ":" + u.port : ""}${path}${query ? "?" + query : ""}`;
  } catch {
    return url;
  }
}

export function normCompany(company: string): string {
  return company.toLowerCase().replace(LEGAL_SUFFIXES, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

export function normTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

export function fingerprint(company: string, title: string, cityGuess: string | null): string {
  const blob = `${normCompany(company)}|${normTitle(title)}|${cityGuess ?? ""}`;
  return createHash("sha1").update(blob).digest("hex");
}

export function parseDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = String(value).trim();
  if (/^\d+$/.test(s)) {
    let ts = parseInt(s, 10);
    if (ts > 1e12) ts = Math.floor(ts / 1000);
    const d = new Date(ts * 1000);
    return isNaN(d.getTime()) ? null : d.toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().replace(/\.\d{3}Z$/, "Z");
  for (const fmt of [/^(\d{4})-(\d{2})-(\d{2})$/, /^(\d{2})-(\d{2})-(\d{4})$/, /^(\d{2})\/(\d{2})\/(\d{4})$/]) {
    const m = s.match(fmt);
    if (m) {
      const iso = fmt.source.startsWith("^(\\d{4})") ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[2]}-${m[1]}`;
      const dd = new Date(iso + "T00:00:00Z");
      if (!isNaN(dd.getTime())) return dd.toISOString().replace(/\.\d{3}Z$/, "Z");
    }
  }
  return null;
}

export function cleanDescription(htmlOrText: string | null | undefined): string {
  return stripPii(stripHtml(htmlOrText)).slice(0, MAX_DESC_CHARS);
}

// Read-layer only: the DB keeps raw HTML. Turns it into markdown-lite blocks
// ("## heading", "- bullet", blank-line-separated paragraphs) so the modal can
// render real structure instead of one wall of text.
const BLOCK_TAGS = new Set([
  "p", "div", "section", "article", "main", "aside", "figure", "figcaption",
  "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre",
  "table", "thead", "tbody", "tr", "td", "th", "dl", "dt", "dd", "hr",
]);

export function formatDescription(htmlOrText: string | null | undefined): string {
  const raw = htmlOrText ?? "";
  if (!raw.trim()) return "";
  if (!raw.includes("<")) {
    return stripPii(raw)
      .replace(/\r/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^[•*]\s+/gm, "- ")
      .trim()
      .slice(0, MAX_DESC_CHARS);
  }
  const $ = cheerio.load(raw);
  $("script,style,noscript,svg,iframe,form,button,input,select,textarea,link,meta").remove();
  const out: string[] = [];
  let buf = "";
  const flush = () => {
    const t = buf.replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").trim();
    if (t) out.push(t);
    buf = "";
  };
  const textOf = (el: any): string => $(el).text().replace(/\s+/g, " ").trim();
  const walk = (node: any) => {
    for (const child of node.children ?? []) {
      if (child.type === "text") { buf += child.data ?? ""; continue; }
      if (child.type !== "tag") continue;
      const tag = String(child.name ?? "").toLowerCase();
      if (tag === "br") { buf += "\n"; continue; }
      if (tag === "hr") { flush(); continue; }
      if (tag === "li") {
        flush();
        const clone = $(child).clone();
        clone.find("ul,ol").remove();
        const t = clone.text().replace(/\s+/g, " ").trim();
        if (t) out.push("- " + t);
        for (const sub of child.children ?? []) {
          if (sub.type === "tag" && (sub.name === "ul" || sub.name === "ol")) walk(sub);
        }
        continue;
      }
      if (/^h[1-6]$/.test(tag)) { flush(); const t = textOf(child); if (t) out.push("## " + t); continue; }
      if (tag === "tr") {
        flush();
        const cells = $(child).find("td,th").map((_, c) => textOf(c)).get().filter(Boolean);
        if (cells.length) out.push(cells.join(" · "));
        continue;
      }
      if (BLOCK_TAGS.has(tag)) { flush(); walk(child); flush(); continue; }
      walk(child);
    }
  };
  walk($.root()[0]);
  flush();
  let joined = "";
  for (const b of out) {
    const lastLine = joined.split("\n").pop() ?? "";
    const sep = b.startsWith("- ") && lastLine.startsWith("- ") ? "\n" : "\n\n";
    joined += (joined ? sep : "") + b;
  }
  return stripPii(joined).trim().slice(0, MAX_DESC_CHARS);
}