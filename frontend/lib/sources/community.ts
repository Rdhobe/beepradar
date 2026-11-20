import { guessCity } from "../cities";
import type { QuotaClient } from "../http";
import { stripHtml } from "../normalize";
import type { RawJob } from "../prefilter";
import { QuotaExhausted } from "../quota";
import type { SourceConfig } from "../registry";

export class HnAdapter {
  constructor(private source: SourceConfig) {}

  async fetch(client: QuotaClient, limit?: number): Promise<RawJob[]> {
    const data = await client.getJson(this.source.api.base_url);
    const hits = data?.hits ?? [];
    if (!hits.length) return [];
    const threadId = hits[0].objectID;
    const thread = await client.getJson(`https://hacker-news.firebaseio.com/v0/item/${threadId}.json`);
    const out: RawJob[] = [];
    try {
      for (const kid of thread?.kids ?? []) {
        const item = await client.getJson(`https://hacker-news.firebaseio.com/v0/item/${kid}.json`);
        if (!item || item.deleted || item.dead || !item.text) continue;
        const text = stripHtml(item.text);
        const firstLine = text.split("\n")[0].slice(0, 200);
        const company = firstLine.split(/\s*[|–—]\s*/)[0].slice(0, 100);
        out.push({
          source: "hn_whoishiring", sourceId: String(kid),
          url: `https://news.ycombinator.com/item?id=${kid}`,
          title: firstLine.slice(0, 150), company: company || "Unknown",
          locationRaw: firstLine, description: text, postedAt: String(item.time),
        });
        if (limit && out.length >= limit) break;
      }
    } catch (e) {
      if (!(e instanceof QuotaExhausted)) throw e;
    }
    return out;
  }
}

const LINK_RE = /\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s|)]+)/;

function cellLink(cell: string): string | null {
  const m = cell.match(LINK_RE);
  return m ? (m[1] ?? m[2]) : null;
}

function cleanCell(cell: string): string {
  return cell.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").trim();
}

export class GithubListsAdapter {
  constructor(private source: SourceConfig) {}

  async fetch(client: QuotaClient, limit?: number): Promise<RawJob[]> {
    const out: RawJob[] = [];
    for (const repo of this.source.api.repos ?? []) {
      const url = this.source.api.base_url.replace("{repo}", repo.repo);
      try {
        const resp = await client.get(url, { useCache: true });
        if (resp === null) continue;
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        out.push(...parseReadme(await resp.text(), repo.repo));
      } catch (e) {
        if (e instanceof QuotaExhausted) break;
        console.error(`[github_lists] ${repo.repo}:`, e);
      }
    }
    return limit ? out.slice(0, limit) : out;
  }
}

export function parseReadme(md: string, repo: string): RawJob[] {
  const out: RawJob[] = [];
  const lines = md.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.startsWith("|") && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
      const header = line.replace(/^\||\|$/g, "").split("|").map((c) => cleanCell(c).toLowerCase());
      const idx: Record<string, number> = {};
      header.forEach((h, n) => {
        if (h.includes("company") || h.includes("organization")) idx.company = n;
        else if (h.includes("position") || h.includes("role") || h.includes("title")) idx.title = n;
        else if (h.includes("location")) idx.location = n;
        else if (h.includes("link") || h.includes("application") || h.includes("apply")) idx.link = n;
      });
      i += 2;
      let lastCompany = "Unknown";
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|");
        i += 1;
        if (idx.title === undefined || idx.link === undefined || cells.length <= Math.max(...Object.values(idx))) continue;
        const link = cellLink(cells[idx.link]);
        if (!link) continue;
        const location = idx.location !== undefined ? cleanCell(cells[idx.location]) : "";
        if (!(guessCity(location) || /india|remote/i.test(location))) continue;
        const company = idx.company !== undefined ? cleanCell(cells[idx.company]).slice(0, 150) : "";
        if (company && !["↳", "-", "→"].includes(company)) lastCompany = company;
        out.push({
          source: "github_internship_lists", sourceId: link, url: link,
          title: cleanCell(cells[idx.title]).slice(0, 200), company: lastCompany,
          locationRaw: location, description: `From curated list ${repo}`, postedAt: null,
        });
      }
    } else {
      i += 1;
    }
  }
  return out;
}