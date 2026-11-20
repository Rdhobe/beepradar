import Parser from "rss-parser";
import type { QuotaClient } from "../http";
import type { RawJob } from "../prefilter";
import { QuotaExhausted } from "../quota";
import type { SourceConfig } from "../registry";

type Collector = (client: QuotaClient, source: SourceConfig, limit: number | undefined, out: RawJob[]) => Promise<void>;

function push(sid: string, out: RawJob[], r: {
  sourceId?: string | null; url?: string | null; title?: string | null; company?: string | null;
  locationRaw?: string | null; description?: string | null; postedAt?: string | null;
}) {
  if (!r.url || !r.title) return;
  out.push({
    source: sid, sourceId: r.sourceId ?? null, url: r.url, title: r.title,
    company: r.company || "Unknown", locationRaw: r.locationRaw ?? null,
    description: r.description ?? null, postedAt: r.postedAt ?? null,
  });
}

const himalayas: Collector = async (client, source, limit, out) => {
  let cursor: number | null = null;
  for (;;) {
    const url: string = `${source.api.base_url}?limit=20` + (cursor ? `&cursor=${cursor}` : "");
    const data: any = await client.getJson(url);
    if (!data) break;
    for (const j of data.jobs ?? []) {
      const restrictions: string[] = j.locationRestrictions ?? [];
      push(source.id, out, {
        sourceId: String(j.id), url: j.applicationLink, title: j.title,
        company: j.companyName, locationRaw: restrictions.join(", ") || "Remote",
        description: j.description, postedAt: j.pubDate != null ? String(j.pubDate) : null,
      });
    }
    cursor = data.nextCursor ?? null;
    if (!cursor || !(data.jobs ?? []).length || (limit && out.length >= limit)) break;
  }
};

const remotive: Collector = async (client, source, _limit, out) => {
  const data = await client.getJson(source.api.base_url + "?category=software-dev");
  for (const j of data?.jobs ?? []) {
    push(source.id, out, {
      sourceId: String(j.id), url: j.url, title: j.title, company: j.company_name,
      locationRaw: j.candidate_required_location, description: j.description, postedAt: j.publication_date,
    });
  }
};

const jobicy: Collector = async (client, source, _limit, out) => {
  const data = await client.getJson(source.api.base_url + "?count=100&geo=apac");
  for (const j of data?.jobs ?? []) {
    push(source.id, out, {
      sourceId: String(j.id), url: j.url, title: j.jobTitle, company: j.companyName,
      locationRaw: j.jobGeo, description: j.jobDescription ?? j.jobExcerpt, postedAt: j.pubDate,
    });
  }
};

const remoteok: Collector = async (client, source, _limit, out) => {
  const data = await client.getJson(source.api.base_url);
  for (const j of Array.isArray(data) ? data : []) {
    if (!j || typeof j !== "object" || "legal" in j) continue;
    push(source.id, out, {
      sourceId: String(j.id), url: j.url ?? `https://remoteok.com/remote-jobs/${j.id}`,
      title: j.position, company: j.company, locationRaw: j.location,
      description: j.description, postedAt: j.date,
    });
  }
};

const rssParser = new Parser({ timeout: 15000 });

const rss: Collector = async (client, source, _limit, out) => {
  const feeds = source.api.feeds ?? [source.api.base_url];
  for (const feedUrl of feeds.slice(0, 3)) {
    const resp = await client.get(feedUrl, { useCache: true });
    if (resp === null) continue;
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const parsed = await rssParser.parseString(await resp.text());
    for (const e of parsed.items ?? []) {
      let company = (e as any).creator ?? e.author ?? "";
      let title = e.title ?? "";
      if (!company && title.includes(":")) {
        const idx = title.indexOf(":");
        company = title.slice(0, idx);
        title = title.slice(idx + 1);
      }
      push(source.id, out, {
        sourceId: e.guid ?? e.link, url: e.link, title: title.trim(),
        company: company.trim() || "Unknown", locationRaw: (e as any).location,
        description: e.contentSnippet ?? e.content, postedAt: e.pubDate ?? e.isoDate,
      });
    }
  }
};

const workingnomads: Collector = async (client, source, _limit, out) => {
  const data = await client.getJson(source.api.base_url);
  for (const j of Array.isArray(data) ? data : []) {
    push(source.id, out, {
      sourceId: String(j.id), url: j.url, title: j.title, company: j.company_name,
      locationRaw: j.location, description: j.description, postedAt: j.pub_date,
    });
  }
};

const fourdayweek: Collector = async (client, source, _limit, out) => {
  const data = await client.getJson(source.api.base_url);
  const jobs = Array.isArray(data) ? data : (data?.jobs ?? []);
  for (const j of jobs) {
    let loc = j.location ?? j.locations;
    if (Array.isArray(loc)) loc = loc.join(", ");
    push(source.id, out, {
      sourceId: String(j.id), url: j.url ?? j.apply_url, title: j.title ?? j.position,
      company: j.company ?? j.company_name, locationRaw: loc,
      description: j.description, postedAt: j.posted_at ?? j.date,
    });
  }
};

const arbeitnow: Collector = async (client, source, _limit, out) => {
  for (let page = 1; page <= 5; page++) {
    const data = await client.getJson(`${source.api.base_url}?page=${page}`);
    const rows = data?.data ?? [];
    if (!rows.length) break;
    for (const j of rows) {
      push(source.id, out, {
        sourceId: j.slug, url: j.url, title: j.title, company: j.company_name,
        locationRaw: j.location, description: j.description, postedAt: String(j.created_at),
      });
    }
  }
};

const themuse: Collector = async (client, source, _limit, out) => {
  for (let page = 1; page <= 20; page++) {
    const data = await client.getJson(`${source.api.base_url}?page=${page}`);
    const rows = data?.results ?? [];
    if (!rows.length) break;
    for (const j of rows) {
      push(source.id, out, {
        sourceId: String(j.id), url: j.refs?.landing_page, title: j.name, company: j.company?.name,
        locationRaw: (j.locations ?? []).map((l: any) => l.name ?? "").join(", "),
        description: j.contents, postedAt: j.publication_date,
      });
    }
    if (page >= (data?.page_count ?? 1)) break;
  }
};

const FEEDS: Record<string, Collector> = {
  himalayas, remotive, jobicy, remoteok,
  weworkremotely_rss: rss, workingnomads, fourdayweek, arbeitnow, themuse,
};

export function isFeedSource(id: string): boolean {
  return id in FEEDS;
}

export class FeedAdapter {
  constructor(private source: SourceConfig) {}

  async fetch(client: QuotaClient, limit?: number): Promise<RawJob[]> {
    const out: RawJob[] = [];
    try {
      await FEEDS[(this.source.api.adapter as string) || this.source.id](client, this.source, limit, out);
    } catch (e) {
      if (!(e instanceof QuotaExhausted)) throw e;
    }
    return limit ? out.slice(0, limit) : out;
  }
}