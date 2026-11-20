"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";

interface Meta {
  counts: { active: number; tagged: number };
  last_refreshed: string | null;
}

interface PreviewJob {
  id: number;
  title: string;
  company: string;
  role: string | null;
  city: string | null;
  job_type: string | null;
  source: string;
  posted_at: string | null;
}

interface JobsResponse {
  total: number;
  preview: boolean;
  results: PreviewJob[];
}

function label(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

const TYPE_COLORS: Record<string, string> = {
  internship: "bg-[#ffd400] text-black",
  fresher_fulltime: "bg-[#2400ff] text-white",
  apprenticeship: "bg-[#00a651] text-white",
  other: "bg-white text-black",
};

const FEATURES = [
  {
    n: "01",
    title: "REAL SOURCES ONLY",
    body: "Public job APIs and official company career boards (Greenhouse, Lever, Ashby…). No scraped job portals — blocklisted sites are never fetched.",
    bg: "bg-[#ffd400]",
  },
  {
    n: "02",
    title: "DEDUPED 3 WAYS",
    body: "Same job posted on five boards? You see it once. URL, fingerprint and fuzzy-title matching collapse cross-source duplicates.",
    bg: "bg-white",
  },
  {
    n: "03",
    title: "AI-TAGGED ROLE + CITY",
    body: "Every post is labelled by a small LLM into 20 roles and 16 Indian cities, with confidence scores and a hand-checked accuracy sample.",
    bg: "bg-white",
  },
  {
    n: "04",
    title: "FRESH EVERY DAY",
    body: "A quota-aware scheduler polls each source on its own rate-limit schedule and retires posts not seen for 14 days.",
    bg: "bg-[#2400ff] text-white",
  },
];

const STEPS = [
  ["COLLECT", "45 registered sources, triggered by their per-hour / per-day / per-month limits — never all at once."],
  ["FILTER + DEDUPE", "India + fresher heuristics, scam and senior-title rejection, then 3-layer dedupe before anything is stored."],
  ["TAG + SERVE", "LLM labels role, city and job type; full-text search with filters serves the result in milliseconds."],
];

export default function LandingPage() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [preview, setPreview] = useState<JobsResponse | null>(null);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => setSignedIn(!!session));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    fetch("/api/meta", { signal: AbortSignal.timeout(15000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => m && setMeta(m))
      .catch(() => {});
    fetch("/api/jobs?page=1&page_size=6", { signal: AbortSignal.timeout(20000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setPreview(j ?? { total: 0, preview: true, results: [] }))
      .catch(() => setPreview({ total: 0, preview: true, results: [] }));
  }, []);

  return (
    <div className="-mt-8">
      <section className="py-14">
        <p className="bchip -rotate-2 bg-[#ff3b30] text-white">FOR INDIAN STUDENTS + FRESH GRADS</p>
        <h1 className="mt-6 text-5xl font-black uppercase leading-[0.95] tracking-tight sm:text-7xl">
          Every fresher
          <br />
          job in India.
          <br />
          <span className="mt-2 inline-block border-4 border-black bg-[#ffd400] px-3 shadow-[8px_8px_0_#000]">
            One radar.
          </span>
        </h1>
        <p className="mt-8 max-w-xl border-l-4 border-black pl-4 font-mono text-sm leading-relaxed">
          BeepRadar watches public job APIs and company career boards around the clock,
          removes duplicates, and tags every opening by role and city —
          so you search once, not forty times.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link href="/jobs" className="bbtn bbtn-yellow px-6 py-3 text-sm">
            Browse jobs →
          </Link>
          {!signedIn && (
            <Link href="/login" className="bbtn px-6 py-3 text-sm">
              Sign in
            </Link>
          )}
        </div>

        <div className="mt-12 grid max-w-2xl grid-cols-3 gap-4">
          {[
            [meta ? meta.counts.active.toLocaleString() : "—", "ACTIVE POSTS"],
            [meta ? meta.counts.tagged.toLocaleString() : "—", "AI-TAGGED"],
            ["45", "SOURCES"],
          ].map(([v, l], i) => (
            <div key={l} className={`bcard p-4 text-center ${i === 1 ? "rotate-1" : i === 2 ? "-rotate-1" : ""}`}>
              <p className="text-3xl font-black">{v}</p>
              <p className="blabel mt-1 text-[10px]">{l}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="pb-4 pt-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="inline-block border-4 border-black bg-[#ffd400] px-3 py-1 text-2xl font-black uppercase shadow-[6px_6px_0_#000]">
            Fresh on the radar
          </h2>
          <Link href="/jobs" className="blabel text-xs underline underline-offset-4">See all →</Link>
        </div>

        {!preview ? (
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-28 animate-pulse border-3 border-black bg-black/10 shadow-[6px_6px_0_#000]" />
            ))}
          </div>
        ) : preview.results.length === 0 ? (
          <div className="bcard mt-8 px-6 py-10 text-center">
            <p className="text-xl font-black uppercase">Radar warming up_</p>
            <p className="blabel mt-2 text-xs text-black/60">NO POSTS YET — CHECK BACK SOON OR BROWSE THE BOARD</p>
          </div>
        ) : (
          <>
            <ul className="mt-8 grid gap-4 sm:grid-cols-2">
              {preview.results.map((job) => (
                <li key={job.id} className="bcard bcard-hover flex flex-col p-4">
                  <h3 className="text-base font-extrabold leading-tight">{job.title}</h3>
                  <p className="blabel mt-1 text-xs text-black/70">{job.company}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {job.city && <span className="bchip bg-[#ffd400]">{label(job.city)}</span>}
                    {job.role && <span className="bchip bg-white">{label(job.role)}</span>}
                    {job.job_type && (
                      <span className={`bchip ${TYPE_COLORS[job.job_type] ?? TYPE_COLORS.other}`}>{label(job.job_type)}</span>
                    )}
                  </div>
                  <p className="blabel mt-3 text-[10px] text-black/50">
                    via {job.source}{job.posted_at ? ` // posted ${timeAgo(job.posted_at)}` : ""}
                  </p>
                </li>
              ))}
            </ul>
            <div className="mt-6 border-4 border-black bg-[#2400ff] p-6 text-center text-white shadow-[8px_8px_0_#000]">
              <p className="text-lg font-black uppercase">
                Showing {preview.results.length} of {preview.total.toLocaleString()} openings
              </p>
              <p className="blabel mt-2 text-[11px] text-white/80">
                {signedIn
                  ? "YOU'RE SIGNED IN — OPEN THE FULL BOARD TO SEARCH, FILTER AND APPLY"
                  : "SIGN IN TO UNLOCK EVERY JOB, FULL SEARCH + FILTERS, AND DIRECT APPLY LINKS"}
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                {signedIn ? (
                  <Link href="/jobs" className="bbtn bbtn-yellow px-6 py-2.5 text-xs">Browse all jobs →</Link>
                ) : (
                  <>
                    <Link href="/login" className="bbtn bbtn-yellow px-6 py-2.5 text-xs">Sign in — it&apos;s free</Link>
                    <Link href="/jobs" className="bbtn px-6 py-2.5 text-xs">Browse jobs</Link>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </section>

      <section className="py-10">
        <h2 className="inline-block border-4 border-black bg-black px-3 py-1 text-2xl font-black uppercase text-white shadow-[6px_6px_0_#ffd400]">
          Why BeepRadar
        </h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.n} className={`bcard bcard-hover p-5 ${f.bg}`}>
              <p className="blabel text-xs opacity-60">{f.n}</p>
              <h3 className="mt-2 text-lg font-black uppercase">{f.title}</h3>
              <p className="mt-2 font-mono text-xs leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="pb-16 pt-6">
        <h2 className="inline-block border-4 border-black bg-[#2400ff] px-3 py-1 text-2xl font-black uppercase text-white shadow-[6px_6px_0_#000]">
          How it works
        </h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          {STEPS.map(([title, body], i) => (
            <div key={title} className="bcard bcard-hover p-5">
              <span className="flex h-10 w-10 items-center justify-center border-3 border-black bg-[#ffd400] text-lg font-black shadow-[3px_3px_0_#000]">
                {i + 1}
              </span>
              <h3 className="mt-3 font-black uppercase">{title}</h3>
              <p className="mt-2 font-mono text-xs leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
        <div className="mt-12 border-4 border-black bg-[#ffd400] p-8 text-center shadow-[8px_8px_0_#000]">
          <p className="text-2xl font-black uppercase">Stop tab-hopping. Start applying.</p>
          <Link href="/jobs" className="bbtn bbtn-ink mt-5 px-8 py-3 text-sm">
            Start searching — it&apos;s free
          </Link>
          <p className="blabel mt-4 text-[10px]">
            Aggregated from public sources. Applications happen on the original site.
          </p>
        </div>
      </section>
    </div>
  );
}