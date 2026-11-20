import { NextResponse } from "next/server";
import { dbGuard } from "@/lib/db/errors";
export const GET = dbGuard(GETImpl);
import { sql } from "@/lib/db/client";
import { rest, ensureRest } from "@/lib/db/rest";
import { resolveTaggingConfig } from "@/lib/llm_config";
import { costPer1000, inrRate, llmCostUsd, resolvePrice, round } from "@/lib/pricing";

export const dynamic = "force-dynamic";

function aggregateRuns(rows: any[]) {
  const by = new Map<string, any>();
  for (const r of rows) {
    const g = by.get(r.source) ?? { source: r.source, runs: 0, fetched: 0, passed: 0, inserted: 0, dup_url: 0, dup_fingerprint: 0, dup_fuzzy: 0, last_run: null };
    g.runs += 1;
    g.fetched += r.fetched ?? 0; g.passed += r.passed_filter ?? 0; g.inserted += r.inserted ?? 0;
    g.dup_url += r.dup_url ?? 0; g.dup_fingerprint += r.dup_fingerprint ?? 0; g.dup_fuzzy += r.dup_fuzzy ?? 0;
    if (r.finished_at && (!g.last_run || r.finished_at > g.last_run)) g.last_run = r.finished_at;
    by.set(r.source, g);
  }
  return [...by.values()].sort((a, b) => b.inserted - a.inserted);
}
function aggregateLlm(rows: any[]) {
  const t = { calls: rows.length, input_tokens: 0, output_tokens: 0, cached_tokens: 0, failed_calls: 0 };
  for (const r of rows) {
    t.input_tokens += r.input_tokens ?? 0; t.output_tokens += r.output_tokens ?? 0;
    t.cached_tokens += r.cached_input_tokens ?? 0; if (!r.ok) t.failed_calls += 1;
  }
  return t;
}

async function GETImpl() {
  let runs: any[], llm: any, tagged: number, ruleTagged: number, quota: any[], states: any[];
  if (await ensureRest()) {
    const [runRows, llmRows, taggedCount, ruleCount, quotaRows, stateRows] = await Promise.all([
      rest("ingest_runs?select=source,fetched,passed_filter,inserted,dup_url,dup_fingerprint,dup_fuzzy,finished_at&limit=5000"),
      rest("llm_runs?select=input_tokens,output_tokens,cached_input_tokens,ok&limit=5000"),
      rest("jobs?select=id&tag_status=eq.done&limit=1", { count: true }),
      rest("jobs?select=id&tag_model=eq.rule-v1&limit=1", { count: true }),
      rest("source_quota_usage?select=source_id,quota_window,count&limit=5000"),
      rest("source_state?select=*&order=source_id.asc&limit=1000"),
    ]);
    runs = aggregateRuns(runRows.rows);
    llm = aggregateLlm(llmRows.rows);
    tagged = taggedCount.total ?? 0;
    ruleTagged = ruleCount.total ?? 0;
    quota = quotaRows.rows.filter((r) => String(r.quota_window).startsWith("d:"));
    states = stateRows.rows;
  } else {
    const [runRows, llmRows, taggedRows, quotaRows, stateRows] = await Promise.all([
      sql`SELECT source, count(*)::int AS runs, sum(fetched)::int AS fetched,
          sum(passed_filter)::int AS passed, sum(inserted)::int AS inserted,
          sum(dup_url)::int AS dup_url, sum(dup_fingerprint)::int AS dup_fingerprint,
          sum(dup_fuzzy)::int AS dup_fuzzy, max(finished_at) AS last_run
          FROM ingest_runs GROUP BY source ORDER BY inserted DESC`,
      sql`SELECT count(*)::int AS calls, coalesce(sum(input_tokens),0)::int AS input_tokens,
          coalesce(sum(output_tokens),0)::int AS output_tokens,
          coalesce(sum(cached_input_tokens),0)::int AS cached_tokens,
          count(*) FILTER (WHERE NOT ok)::int AS failed_calls
          FROM llm_runs`,
      sql`SELECT count(*)::int AS c, count(*) FILTER (WHERE tag_model = 'rule-v1')::int AS rule_c
          FROM jobs WHERE tag_status = 'done'`,
      sql`SELECT source_id, quota_window, count FROM source_quota_usage WHERE quota_window LIKE 'd:%' ORDER BY source_id`,
      sql`SELECT * FROM source_state ORDER BY source_id`,
    ]);
    runs = runRows; llm = llmRows[0]; tagged = taggedRows[0].c; ruleTagged = taggedRows[0].rule_c;
    quota = quotaRows; states = stateRows;
  }

  const llmTagged = Math.max(0, tagged - ruleTagged);
  const cfg = await resolveTaggingConfig();
  const price = resolvePrice(cfg.model, cfg.provider);
  const rate = inrRate();
  const spend = llmCostUsd(
    { input_tokens: llm.input_tokens, output_tokens: llm.output_tokens, cached_tokens: llm.cached_tokens },
    price,
  );
  const pricing = {
    mode: cfg.mode,
    provider: cfg.provider,
    model: cfg.model,
    price_label: price.label,
    price_source: price.source,
    inr_rate: rate,
    input_per_m: round(price.input_per_m * rate, 2),
    output_per_m: round(price.output_per_m * rate, 2),
    cache_read_per_m: round(price.cache_read_per_m * rate, 2),
    input_per_m_usd: price.input_per_m,
    output_per_m_usd: price.output_per_m,
    input_cost: round(spend.input * rate, 2),
    output_cost: round(spend.output * rate, 2),
    cache_cost: round(spend.cache * rate, 2),
    llm_cost: round(spend.total * rate, 2),
    total_tagged_posts: tagged,
    rule_tagged_posts: ruleTagged,
    llm_tagged_posts: llmTagged,
    cost_per_1000_llm: round(costPer1000(spend.total, llmTagged) * rate, 2),
    cost_per_1000_blended: round(costPer1000(spend.total, tagged) * rate, 2),
    rule_cost_per_1000: 0,
    tokens_per_post: llmTagged
      ? { input: round(llm.input_tokens / llmTagged, 1), output: round(llm.output_tokens / llmTagged, 1) }
      : null,
  };

  return NextResponse.json({
    ingest_by_source: runs, llm_totals: llm, pricing,
    quota_today: quota, source_state: states,
  });
}