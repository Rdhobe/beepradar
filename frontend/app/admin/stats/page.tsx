"use client";

import { useEffect, useState } from "react";

interface RunRow {
  source: string; runs: number; fetched: number; passed: number; inserted: number;
  dup_url: number; dup_fingerprint: number; dup_fuzzy: number; last_run: string | null;
}
interface Pricing {
  mode: "free" | "llm"; provider: string;
  model: string; price_label: string; price_source: "env" | "table" | "default";
  inr_rate: number;
  input_per_m: number; output_per_m: number; cache_read_per_m: number;
  input_per_m_usd: number; output_per_m_usd: number;
  input_cost: number; output_cost: number; cache_cost: number; llm_cost: number;
  total_tagged_posts: number; rule_tagged_posts: number; llm_tagged_posts: number;
  cost_per_1000_llm: number; cost_per_1000_blended: number; rule_cost_per_1000: number;
  tokens_per_post: { input: number; output: number } | null;
}
interface Stats {
  ingest_by_source: RunRow[];
  llm_totals: { calls: number; input_tokens: number; output_tokens: number; cached_tokens: number; failed_calls: number };
  pricing: Pricing;
  quota_today: { source_id: string; quota_window: string; count: number }[];
  source_state: { source_id: string; last_status: string | null; last_run_at: string | null; next_due_at: string | null; backoff_until: string | null; consecutive_429: number }[];
}
interface SourcesResp {
  groups: { id: string; name: string; policy: string }[];
  sources: { id: string; name: string; group: string; enabled: boolean; priority: number; schedule: { cron: string }; state: { last_status: string | null } | null }[];
}

function fmt(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString();
}
function dt(s: string | null): string {
  return s ? new Date(s).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "—";
}
function inr(n: number, dp = 2): string {
  return "₹" + (n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

async function readJson(r: Response, label: string) {
  if (!r.ok) {
    let msg = `${label} ${r.status}`;
    try { const j = await r.json(); if (j?.error) msg = j.error; } catch { /* non-JSON body */ }
    throw new Error(msg);
  }
  return r.json();
}

export default function StatsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [sources, setSources] = useState<SourcesResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/stats", { signal: AbortSignal.timeout(20000) }).then((r) => { if (!r.ok) throw new Error(`stats ${r.status}`); return r.json(); }),
      fetch("/api/sources", { signal: AbortSignal.timeout(20000) }).then((r) => { if (!r.ok) throw new Error(`sources ${r.status}`); return r.json(); }),
    ])
      .then(([s, src]) => { setStats(s); setSources(src); })
      .catch((e) => setError(
        e instanceof Error && e.name === "TimeoutError"
          ? "Stats API timed out — is the database reachable?"
          : e instanceof Error ? e.message : "Failed to load"));
  }, []);

  if (error) return <div className="bcard bg-[#ff3b30] px-4 py-3 text-sm font-bold text-white">!! {error}</div>;
  if (!stats || !sources) return <div className="h-64 animate-pulse border-3 border-black bg-black/10 shadow-[6px_6px_0_#000]" />;

  const totals = stats.ingest_by_source.reduce(
    (a, r) => ({
      fetched: a.fetched + r.fetched, passed: a.passed + r.passed, inserted: a.inserted + r.inserted,
      dup_url: a.dup_url + r.dup_url, dup_fingerprint: a.dup_fingerprint + r.dup_fingerprint, dup_fuzzy: a.dup_fuzzy + r.dup_fuzzy,
    }),
    { fetched: 0, passed: 0, inserted: 0, dup_url: 0, dup_fingerprint: 0, dup_fuzzy: 0 },
  );

  return (
    <div className="space-y-10">
      <div>
        <span className="bchip inline-block -rotate-1 bg-black text-[#ffd400]">ADMIN_</span>
        <h1 className="mt-3 text-3xl font-black uppercase leading-none tracking-tight">Pipeline stats<span className="text-[#2400ff]">_</span></h1>
      </div>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ["Raw fetched", totals.fetched, "bg-white"],
          ["Passed filter", totals.passed, "bg-[#ffd400]"],
          ["Unique inserted", totals.inserted, "bg-[#2400ff] text-white"],
          ["Duplicates dropped", totals.dup_url + totals.dup_fingerprint + totals.dup_fuzzy, "bg-white"],
        ].map(([label, v, color]) => (
          <div key={label as string} className={`bcard p-4 ${color}`}>
            <p className="blabel text-[10px] opacity-70">{label}</p>
            <p className="mt-1 text-3xl font-black">{fmt(v as number)}</p>
          </div>
        ))}
      </section>

      <section>
        <h2 className="blabel mb-3 border-l-4 border-black pl-3 text-sm">01 // Ingest funnel by source</h2>
        <div className="overflow-x-auto pb-2 pr-2">
          <table className="btable min-w-full">
            <thead>
              <tr>
                <th>Source</th><th>Runs</th><th>Fetched</th>
                <th>Passed</th><th>Inserted</th><th>Dup URL</th>
                <th>Dup fp</th><th>Dup fuzzy</th><th>Last run</th>
              </tr>
            </thead>
            <tbody>
              {stats.ingest_by_source.map((r) => (
                <tr key={r.source}>
                  <td className="font-bold">{r.source}</td>
                  <td>{fmt(r.runs)}</td><td>{fmt(r.fetched)}</td>
                  <td>{fmt(r.passed)}</td><td>{fmt(r.inserted)}</td>
                  <td>{fmt(r.dup_url)}</td><td>{fmt(r.dup_fingerprint)}</td>
                  <td>{fmt(r.dup_fuzzy)}</td><td className="font-mono text-xs">{dt(r.last_run)}</td>
                </tr>
              ))}
              {stats.ingest_by_source.length === 0 && (
                <tr><td colSpan={9}>No ingest runs yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="blabel mb-3 border-l-4 border-black pl-3 text-sm">02 // Pricing &amp; unit cost</h2>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="bcard bg-[#2400ff] p-5 text-white">
            <p className="blabel text-[10px] text-white/70">BLENDED ACTUAL COST</p>
            <p className="mt-1 text-4xl font-black leading-none">{inr(stats.pricing.cost_per_1000_blended, 2)}</p>
            <p className="blabel mt-2 text-[10px] text-white/80">PER 1,000 TAGGED POSTS</p>
            <p className="mt-3 border-t-2 border-white/30 pt-2 font-mono text-[10px] text-white/70">
              {fmt(stats.pricing.total_tagged_posts)} posts · {inr(stats.pricing.llm_cost, 2)} spend
            </p>
          </div>
          <div className="bcard bg-[#00a651] p-5 text-white">
            <p className="blabel text-[10px] text-white/70">RULE TAGGING · DEFAULT</p>
            <p className="mt-1 text-4xl font-black leading-none">₹0.00</p>
            <p className="blabel mt-2 text-[10px] text-white/80">PER 1,000 POSTS · NO API</p>
            <p className="mt-3 border-t-2 border-white/30 pt-2 font-mono text-[10px] text-white/70">
              {fmt(stats.pricing.rule_tagged_posts)} tagged free at ingest
            </p>
          </div>
          <div className="bcard bg-[#ffd400] p-5">
            <p className="blabel text-[10px] opacity-70">LLM ADD-ON · OPTIONAL</p>
            <p className="mt-1 text-4xl font-black leading-none">
              {stats.pricing.llm_tagged_posts ? inr(stats.pricing.cost_per_1000_llm, 2) : "—"}
            </p>
            <p className="blabel mt-2 text-[10px] opacity-70">PER 1,000 LLM-TAGGED POSTS</p>
            <p className="mt-3 border-t-2 border-black/30 pt-2 font-mono text-[10px] opacity-70">
              {fmt(stats.pricing.llm_tagged_posts)} posts · {inr(stats.pricing.llm_cost, 2)} spend
            </p>
          </div>
          <div className="bcard bg-white p-5">
            <p className="blabel text-[10px] opacity-70">TOTAL LLM SPEND</p>
            <p className="mt-1 text-4xl font-black leading-none">{inr(stats.pricing.llm_cost, 2)}</p>
            <p className="blabel mt-2 text-[10px] opacity-70">ALL RUNS TO DATE</p>
            <p className="mt-3 border-t-2 border-black/20 pt-2 font-mono text-[10px] opacity-70">
              in {inr(stats.pricing.input_cost, 2)} · out {inr(stats.pricing.output_cost, 2)} · cache {inr(stats.pricing.cache_cost, 2)}
            </p>
          </div>
        </div>

        <div className="bcard mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 bg-black p-3 text-white">
          <span className="bchip bg-[#ffd400] text-black">
            {stats.pricing.price_source === "env" ? "ENV RATE" : stats.pricing.price_source === "table" ? "LIST RATE" : "ESTIMATE"}
          </span>
          <span className="bchip bg-white text-black">{stats.pricing.provider.toUpperCase()}</span>
          <span className="font-mono text-xs">{stats.pricing.model}</span>
          <span className="blabel text-[10px] text-white/60">{stats.pricing.price_label}</span>
          <span className="font-mono text-xs text-white/80">
            IN {inr(stats.pricing.input_per_m, 2)}/M · OUT {inr(stats.pricing.output_per_m, 2)}/M · CACHE {inr(stats.pricing.cache_read_per_m, 2)}/M
          </span>
          <span className="bchip ml-auto bg-[#2400ff] text-white">FX ₹{stats.pricing.inr_rate}/$</span>
        </div>
        <p className="blabel mt-2 text-[9px] text-black/50">
          {`PROVIDER BILLS USD ($${stats.pricing.input_per_m_usd}/M IN · $${stats.pricing.output_per_m_usd}/M OUT), SHOWN IN ₹ AT ₹${stats.pricing.inr_rate}/$. OVERRIDE: LLM_INPUT_PRICE_PER_M / LLM_OUTPUT_PRICE_PER_M (USD PER 1M) · USD_INR_RATE.`}
        </p>

        <div className="bcard mt-4 p-4 text-sm">
          <p className="font-mono text-xs">
            LLM CALLS: <b>{fmt(stats.llm_totals.calls)}</b> ({fmt(stats.llm_totals.failed_calls)} FAILED) //
            INPUT: <b>{fmt(stats.llm_totals.input_tokens)}</b> //
            OUTPUT: <b>{fmt(stats.llm_totals.output_tokens)}</b> //
            CACHED: <b>{fmt(stats.llm_totals.cached_tokens)}</b>
            {stats.pricing.tokens_per_post && (
              <> // TOKENS/POST: <b>{stats.pricing.tokens_per_post.input}</b> IN / <b>{stats.pricing.tokens_per_post.output}</b> OUT</>
            )}
          </p>
          {stats.pricing.llm_tagged_posts === 0 && (
            <p className="blabel mt-3 border-t-2 border-black pt-3 text-[10px] text-black/60">
              NO LLM SPEND YET — THE PIPELINE TAGS WITH RULES AT INGEST FOR ₹0. FETCHING PUBLIC ATS BOARDS IS FREE. RUN THE OPTIONAL LLM TAGGER FOR ACTUAL ₹/1,000, OR PROJECT IT BELOW.
            </p>
          )}
        </div>

        <CostEstimator pricing={stats.pricing} />
      </section>

      <section>
        <h2 className="blabel mb-3 border-l-4 border-black pl-3 text-sm">03 // Source schedule &amp; state ({sources.sources.filter((s) => s.enabled).length} enabled)</h2>
        <div className="overflow-x-auto pb-2 pr-2">
          <table className="btable min-w-full">
            <thead>
              <tr>
                <th>Source</th><th>Group</th><th>Cron (UTC)</th>
                <th>Enabled</th><th>Last status</th><th>Next due</th><th>Backoff until</th>
              </tr>
            </thead>
            <tbody>
              {sources.sources.map((s) => {
                const st = stats.source_state.find((x) => x.source_id === s.id);
                return (
                  <tr key={s.id} className={s.enabled ? "" : "opacity-50"}>
                    <td className="font-bold">{s.name}</td>
                    <td>{s.group}</td>
                    <td className="font-mono text-xs">{s.schedule.cron}</td>
                    <td>
                      <span className={`bchip ${s.enabled ? "bg-[#00a651] text-white" : "bg-white text-black/50"}`}>
                        {s.enabled ? "yes" : "no"}
                      </span>
                    </td>
                    <td className="font-mono text-xs">{st?.last_status ?? "—"}</td>
                    <td className="font-mono text-xs">{dt(st?.next_due_at ?? null)}</td>
                    <td className="font-mono text-xs">{dt(st?.backoff_until ?? null)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="blabel mb-3 border-l-4 border-black pl-3 text-sm">04 // Quota usage today (UTC day)</h2>
        <div className="bcard p-4">
          {stats.quota_today.length === 0 ? (
            <p className="blabel text-xs text-black/60">NO REQUESTS RECORDED TODAY</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {stats.quota_today.map((q) => (
                <span key={q.source_id + q.quota_window} className="bchip bg-[#ffd400]">
                  {q.source_id}: <b>{q.count}</b>
                </span>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

const PRESETS = [1000, 10000, 100000, 1000000];
function presetLabel(n: number): string {
  return n >= 1e6 ? `${n / 1e6}M` : n >= 1000 ? `${n / 1000}k` : String(n);
}

function CostEstimator({ pricing }: { pricing: Pricing }) {
  const seedIn = pricing.tokens_per_post?.input ?? 900;
  const seedOut = pricing.tokens_per_post?.output ?? 120;
  const [vol, setVol] = useState(1000);
  const [tin, setTin] = useState(seedIn);
  const [tout, setTout] = useState(seedOut);
  const [llm, setLlm] = useState(true);

  const llmPerPost = (tin / 1e6) * pricing.input_per_m + (tout / 1e6) * pricing.output_per_m;
  const perPost = llm ? llmPerPost : 0;
  const per1000 = perPost * 1000;
  const total = perPost * vol;
  const reset = () => { setVol(1000); setTin(seedIn); setTout(seedOut); setLlm(true); };

  return (
    <div className="bcard mt-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="blabel text-xs">COST ESTIMATOR_ PROJECT ₹/1,000 AT YOUR VOLUME</p>
        <button className="bbtn px-2 py-0.5 text-[10px]" onClick={reset}>Reset</button>
      </div>

      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="blabel w-28 shrink-0 text-[10px]">TAGGER</span>
            <div className="flex gap-1">
              <button className={`bchip cursor-pointer ${llm ? "bg-[#2400ff] text-white" : "bg-white"}`} onClick={() => setLlm(true)}>LLM</button>
              <button className={`bchip cursor-pointer ${!llm ? "bg-[#00a651] text-white" : "bg-white"}`} onClick={() => setLlm(false)}>RULE · FREE</button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <span className="blabel text-[10px]">POSTS</span>
              <span className="font-mono text-xs font-bold">{fmt(vol)}</span>
            </div>
            <input type="range" min={100} max={1000000} step={100} value={vol}
              onChange={(e) => setVol(Number(e.target.value))} className="mt-1 w-full accent-[#2400ff]" aria-label="Post volume" />
            <div className="mt-1 flex flex-wrap gap-1">
              {PRESETS.map((n) => (
                <button key={n} className={`bchip cursor-pointer ${vol === n ? "bg-[#ffd400]" : "bg-white"}`} onClick={() => setVol(n)}>
                  {presetLabel(n)}
                </button>
              ))}
            </div>
          </div>

          <div className={llm ? "" : "pointer-events-none opacity-40"}>
            <div className="flex items-center justify-between">
              <span className="blabel text-[10px]">INPUT TOKENS / POST</span>
              <span className="font-mono text-xs font-bold">{fmt(tin)}</span>
            </div>
            <input type="range" min={0} max={4000} step={10} value={tin} disabled={!llm}
              onChange={(e) => setTin(Number(e.target.value))} className="mt-1 w-full accent-[#ffd400]" aria-label="Input tokens per post" />
          </div>

          <div className={llm ? "" : "pointer-events-none opacity-40"}>
            <div className="flex items-center justify-between">
              <span className="blabel text-[10px]">OUTPUT TOKENS / POST</span>
              <span className="font-mono text-xs font-bold">{fmt(tout)}</span>
            </div>
            <input type="range" min={0} max={1000} step={5} value={tout} disabled={!llm}
              onChange={(e) => setTout(Number(e.target.value))} className="mt-1 w-full accent-[#ff3b30]" aria-label="Output tokens per post" />
          </div>
        </div>

        <div className="flex flex-col justify-between gap-3 border-3 border-black bg-[#f4f1ea] p-4">
          <div>
            <p className="blabel text-[10px] opacity-60">PROJECTED COST / 1,000 POSTS</p>
            <p className="text-4xl font-black leading-none">{inr(per1000, 2)}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 font-mono text-xs">
            <div className="border-2 border-black bg-white p-2">
              <p className="blabel text-[9px] opacity-60">TOTAL @ {fmt(vol)}</p>
              <p className="text-lg font-black">{inr(total, 2)}</p>
            </div>
            <div className="border-2 border-black bg-white p-2">
              <p className="blabel text-[9px] opacity-60">PER POST</p>
              <p className="text-lg font-black">{inr(perPost, 4)}</p>
            </div>
          </div>
          <p className="blabel text-[9px] opacity-60">
            {llm
              ? `AT ${inr(pricing.input_per_m, 2)}/M IN + ${inr(pricing.output_per_m, 2)}/M OUT · EXCLUDES CACHE READS`
              : "RULE TAGGING RUNS AT INGEST WITH NO API CALLS — ₹0 MARGINAL COST"}
          </p>
        </div>
      </div>

      <div className="bscroll mt-4 overflow-x-auto pb-1">
        <table className="btable min-w-full">
          <thead>
            <tr><th>Volume</th><th>Rule (free)</th><th>LLM total</th><th>LLM ₹/1,000</th></tr>
          </thead>
          <tbody>
            {PRESETS.map((n) => (
              <tr key={n}>
                <td className="font-bold">{fmt(n)} posts</td>
                <td className="font-mono text-xs font-bold text-[#00a651]">₹0.00</td>
                <td className="font-mono text-xs">{inr(llmPerPost * n, 2)}</td>
                <td className="font-mono text-xs">{inr(llmPerPost * 1000, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}