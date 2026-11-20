"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import JobModal from "@/components/JobModal";
import { getSupabase } from "@/lib/supabase/client";

interface Job {
  id: number;
  title: string;
  company: string;
  location_raw: string | null;
  role: string | null;
  city: string | null;
  job_type: string | null;
  is_fresher: boolean | null;
  tag_status: string;
  source: string;
  url: string;
  posted_at: string | null;
  first_seen_at: string;
  description_snippet: string;
}

interface JobsResponse {
  total: number;
  page: number;
  page_size: number;
  preview?: boolean;
  last_refreshed: string | null;
  results: Job[];
}

interface Meta {
  available_roles: string[];
  available_cities: string[];
  job_types: string[];
  counts: { active: number; tagged: number };
  last_refreshed: string | null;
}

const PAGE_SIZE = 20;
const ANON_PAGE_SIZE = 6;

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

export default function HomePage() {
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [city, setCity] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<JobsResponse | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metaError, setMetaError] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [selected, setSelected] = useState<Job | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const signedIn = !!token;

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) { setAuthReady(true); return; }
    sb.auth.getSession().then(({ data }) => {
      setToken(data.session?.access_token ?? null);
      setAuthReady(true);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      setToken(session?.access_token ?? null);
      setAuthReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    fetch("/api/meta", { signal: AbortSignal.timeout(20000) })
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setMeta)
      .catch(() => setMetaError(true));
  }, []);

  const load = useCallback(async (query: string, r: string, c: string, t: string, p: number, tok: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const authed = !!tok;
      const params = new URLSearchParams({
        page: String(authed ? p : 1),
        page_size: String(authed ? PAGE_SIZE : ANON_PAGE_SIZE),
      });
      if (authed) {
        if (query.trim()) params.set("q", query.trim());
        if (r) params.set("role", r);
        if (c) params.set("city", c);
        if (t) params.set("type", t);
      }
      const headers: Record<string, string> = {};
      if (tok) headers.Authorization = `Bearer ${tok}`;
      const resp = await fetch(`/api/jobs?${params}`, { headers, signal: AbortSignal.timeout(20000) });
      if (!resp.ok) {
        let msg = `API error ${resp.status}`;
        try { const j = await resp.json(); if (j?.error) msg = j.error; } catch { /* non-JSON body */ }
        throw new Error(msg);
      }
      setData(await resp.json());
    } catch (e) {
      setError(e instanceof Error
        ? (e.name === "TimeoutError" ? "Request timed out — the database may be unreachable" : e.message)
        : "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authReady) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => load(q, role, city, type, page, token), q ? 300 : 0);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [q, role, city, type, page, token, authReady, load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div>
      <section className="mb-8">
        <span className="bchip inline-block -rotate-1 bg-[#ff3b30] text-white">THE JOB BOARD</span>
        <h1 className="mt-3 text-3xl font-black uppercase leading-none tracking-tight sm:text-4xl">
          Fresher &amp; intern jobs<span className="text-[#2400ff]">_</span>India
        </h1>
        <p className="blabel mt-3 border-l-4 border-black pl-3 text-xs text-black/70">
          {meta ? `${meta.counts.active} ACTIVE POSTS` : metaError ? "LIVE COUNTS UNAVAILABLE" : "LOADING…"}
          {data?.last_refreshed ? ` // REFRESHED ${timeAgo(data.last_refreshed).toUpperCase()}` : ""}
          {" // "}PUBLIC APIS + CAREER BOARDS // DEDUPLICATED // AI-TAGGED
        </p>
      </section>

      {signedIn ? (
        <section className="mb-6 flex flex-col gap-3 sm:flex-row">
          <input
            type="search"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="SEARCH TITLE, COMPANY, SKILLS… e.g. react intern"
            className="binput w-full px-4 py-2.5 text-sm sm:flex-1"
          />
          <div className="grid grid-cols-3 gap-3 sm:flex">
            <select value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}
              className="binput px-2 py-2.5 text-xs uppercase">
              <option value="">All roles</option>
              {(meta?.available_roles ?? []).map((r) => <option key={r} value={r}>{label(r)}</option>)}
            </select>
            <select value={city} onChange={(e) => { setCity(e.target.value); setPage(1); }}
              className="binput px-2 py-2.5 text-xs uppercase">
              <option value="">All cities</option>
              {(meta?.available_cities ?? []).map((c) => <option key={c} value={c}>{label(c)}</option>)}
            </select>
            <select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}
              className="binput px-2 py-2.5 text-xs uppercase">
              <option value="">All types</option>
              {(meta?.job_types ?? []).map((t) => <option key={t} value={t}>{label(t)}</option>)}
            </select>
          </div>
        </section>
      ) : (
        <section className="bcard mb-6 flex flex-col items-start gap-3 bg-[#ffd400] p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="blabel text-xs text-black">
            PREVIEW MODE // SIGN IN TO UNLOCK ALL {data ? data.total.toLocaleString() : ""} JOBS, FULL SEARCH + FILTERS, AND DIRECT APPLY LINKS
          </p>
          <Link href="/login" className="bbtn bbtn-ink shrink-0 px-4 py-2 text-xs">Sign in — it&apos;s free</Link>
        </section>
      )}

      {error && (
        <div className="bcard mb-6 bg-[#ff3b30] px-4 py-3 text-sm font-bold text-white">
          !! {error} — <button className="underline underline-offset-2" onClick={() => load(q, role, city, type, page, token)}>RETRY</button>
        </div>
      )}

      {loading && !data ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-28 animate-pulse border-3 border-black bg-black/10 shadow-[6px_6px_0_#000]" />
          ))}
        </div>
      ) : data && data.results.length === 0 ? (
        <div className="bcard px-6 py-12 text-center">
          <p className="text-2xl font-black uppercase">No jobs match_</p>
          <p className="blabel mt-2 text-xs text-black/60">
            {signedIn ? "TRY FEWER FILTERS OR A BROADER SEARCH TERM" : "THE RADAR IS WARMING UP — CHECK BACK SOON"}
          </p>
          {signedIn && (q || role || city || type) && (
            <button
              className="bbtn bbtn-yellow mt-6 px-4 py-2 text-xs"
              onClick={() => { setQ(""); setRole(""); setCity(""); setType(""); setPage(1); }}>
              Clear all filters
            </button>
          )}
        </div>
      ) : (
        <>
          <p className="blabel mb-4 text-xs text-black/70">
            {signedIn
              ? `${data?.total ?? 0} RESULT${data?.total === 1 ? "" : "S"}`
              : `SHOWING ${data?.results.length ?? 0} OF ${data?.total.toLocaleString() ?? 0}`}
            {loading ? " // UPDATING…" : ""}
          </p>
          <ul className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {data?.results.map((job) => (
              <li
                key={job.id}
                role="button"
                tabIndex={0}
                aria-label={`View full details for ${job.title} at ${job.company}`}
                onClick={() => setSelected(job)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(job); }
                }}
                className="bcard bcard-hover flex h-full cursor-pointer flex-col p-4 focus-visible:outline-3 focus-visible:outline-[#2400ff]"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="min-w-0 text-lg font-extrabold leading-tight">{job.title}</h2>
                  {signedIn && job.url ? (
                    <a
                      href={job.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="bbtn bbtn-green shrink-0 px-3 py-1.5 text-center text-[11px]">
                      Apply at source ↗
                    </a>
                  ) : (
                    <Link
                      href="/login"
                      onClick={(e) => e.stopPropagation()}
                      className="bbtn bbtn-green shrink-0 px-3 py-1.5 text-center text-[11px]">
                      Sign in to apply ↗
                    </Link>
                  )}
                </div>
                <p className="blabel mt-1 text-xs text-black/70">
                  {job.company}
                  {job.location_raw ? ` // ${job.location_raw}` : ""}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {job.city && <span className="bchip bg-[#ffd400]">{label(job.city)}</span>}
                  {job.role && <span className="bchip bg-white">{label(job.role)}</span>}
                  {job.job_type && (
                    <span className={`bchip ${TYPE_COLORS[job.job_type] ?? TYPE_COLORS.other}`}>
                      {label(job.job_type)}
                    </span>
                  )}
                  {job.tag_status !== "done" && (
                    <span className="bchip bg-black/10 text-black/60">untagged</span>
                  )}
                </div>
                {job.description_snippet && (
                  <p className="mt-3 line-clamp-2 border-l-2 border-black/20 pl-2 text-xs text-black/60">{job.description_snippet}</p>
                )}
                <div className="mt-auto flex items-end justify-between gap-2 pt-3">
                  <span className="blabel text-[10px] text-black/50">
                    {job.posted_at ? `posted ${timeAgo(job.posted_at)}` : ""}
                  </span>
                  <span className="bchip bg-black px-1.5 text-[9px] text-[#ffd400]">via {job.source}</span>
                </div>
              </li>
            ))}
          </ul>

          {signedIn && totalPages > 1 && (
            <div className="mt-8 flex items-center justify-center gap-4">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="bbtn px-3 py-1.5 text-xs">
                ← Prev
              </button>
              <span className="blabel text-xs">PAGE {page} / {totalPages}</span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="bbtn px-3 py-1.5 text-xs">
                Next →
              </button>
            </div>
          )}

          {!signedIn && (data?.total ?? 0) > (data?.results.length ?? 0) && (
            <div className="mt-8 border-4 border-black bg-[#2400ff] p-6 text-center text-white shadow-[8px_8px_0_#000]">
              <p className="text-xl font-black uppercase">
                {((data?.total ?? 0) - (data?.results.length ?? 0)).toLocaleString()} more openings inside
              </p>
              <p className="blabel mt-2 text-[11px] text-white/80">
                SIGN IN TO SEE EVERY JOB, SEARCH + FILTER BY ROLE AND CITY, AND APPLY DIRECTLY AT THE SOURCE
              </p>
              <Link href="/login" className="bbtn bbtn-yellow mt-4 px-6 py-2.5 text-xs">Sign in — it&apos;s free</Link>
            </div>
          )}
        </>
      )}

      {selected && (
        <JobModal job={selected} signedIn={signedIn} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}