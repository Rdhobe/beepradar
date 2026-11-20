"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export interface JobSummary {
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

interface SeenVia { source: string; url: string; seen_at: string }
interface JobDetail extends JobSummary {
  tag_confidence: number | null;
  tag_model: string | null;
  description: string;
  seen_via: SeenVia[];
}

const TYPE_COLORS: Record<string, string> = {
  internship: "bg-[#ffd400] text-black",
  fresher_fulltime: "bg-[#2400ff] text-white",
  apprenticeship: "bg-[#00a651] text-white",
  other: "bg-white text-black",
};

function label(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// Renders the read-layer markdown-lite description: "## " headings, "- "
// bullets, blank-line-separated paragraphs (single newlines kept as breaks).
function DescriptionBody({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flushPara = () => {
    if (para.length) {
      nodes.push(<p key={`p${nodes.length}`} className="mt-2 whitespace-pre-line text-sm leading-relaxed text-black/80">{para.join("\n")}</p>);
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      nodes.push(
        <ul key={`u${nodes.length}`} className="mt-2 space-y-1.5 text-sm leading-relaxed text-black/80">
          {list.map((l, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 bg-[#00a651]" />
              <span>{l}</span>
            </li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  for (const line of text.split("\n")) {
    if (line.startsWith("- ")) { flushPara(); list.push(line.slice(2)); }
    else if (line.startsWith("## ")) {
      flushPara(); flushList();
      nodes.push(<h3 key={`h${nodes.length}`} className="mt-4 text-xs font-black uppercase tracking-wide text-black">{line.slice(3)}</h3>);
    } else if (!line.trim()) { flushPara(); flushList(); }
    else { flushList(); para.push(line); }
  }
  flushPara(); flushList();
  return (
    <div className="mt-2 border-l-4 border-[#00a651] pl-3">
      {nodes.length ? nodes : <p className="text-sm text-black/60">No description provided.</p>}
    </div>
  );
}

export default function JobModal({ job, signedIn, onClose }: {
  job: JobSummary;
  signedIn: boolean;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const closeRef = useRef<HTMLButtonElement>(null);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/jobs/${job.id}`, { signal: AbortSignal.timeout(20000) });
      if (!resp.ok) throw new Error(`API error ${resp.status}`);
      setDetail(await resp.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load job");
    } finally {
      setLoading(false);
    }
  }, [job.id]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const d = detail ?? job;
  const applyUrl = signedIn ? (detail?.url || job.url) : "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="job-modal-title"
    >
      <div
        className="bcard flex max-h-[88vh] w-full max-w-3xl flex-col bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-start justify-between gap-3 border-b-3 border-black bg-[#ffd400] px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="blabel text-[10px] text-black/70">JOB DOSSIER // #{job.id}</p>
            <h2 id="job-modal-title" className="mt-1 truncate text-lg font-black uppercase leading-tight sm:text-xl">
              {d.title}
            </h2>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close job details"
            className="bbtn bbtn-ink shrink-0 px-3 py-1 text-sm"
          >
            ✕
          </button>
        </div>

        {/* scrollable body */}
        <div className="bscroll min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <p className="blabel text-xs text-black/70">
            {d.company}{d.location_raw ? ` // ${d.location_raw}` : ""}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {d.city && <span className="bchip bg-[#ffd400]">{label(d.city)}</span>}
            {d.role && <span className="bchip bg-white">{label(d.role)}</span>}
            {d.job_type && (
              <span className={`bchip ${TYPE_COLORS[d.job_type] ?? TYPE_COLORS.other}`}>{label(d.job_type)}</span>
            )}
            {d.is_fresher === true && <span className="bchip bg-[#00a651] text-white">fresher</span>}
            {d.is_fresher === false && <span className="bchip bg-white">experienced</span>}
            {d.tag_status === "done"
              ? <span className="bchip bg-[#2400ff] text-white">{detail?.tag_model && detail.tag_model !== "rule-v1" ? "ai-tagged" : "rule-tagged"}{detail?.tag_confidence != null ? ` ${Math.round(detail.tag_confidence * 100)}%` : ""}</span>
              : <span className="bchip bg-black/10 text-black/60">untagged</span>}
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="border-2 border-black bg-[#f4f1ea] px-2 py-1.5">
              <dt className="blabel text-[9px] text-black/60">Posted</dt>
              <dd className="text-xs font-extrabold">{fmtDate(d.posted_at)}</dd>
            </div>
            <div className="border-2 border-black bg-[#f4f1ea] px-2 py-1.5">
              <dt className="blabel text-[9px] text-black/60">First seen</dt>
              <dd className="text-xs font-extrabold">{fmtDate(d.first_seen_at)}</dd>
            </div>
            <div className="border-2 border-black bg-[#f4f1ea] px-2 py-1.5">
              <dt className="blabel text-[9px] text-black/60">Source</dt>
              <dd className="truncate text-xs font-extrabold uppercase">{d.source}</dd>
            </div>
            <div className="border-2 border-black bg-[#f4f1ea] px-2 py-1.5">
              <dt className="blabel text-[9px] text-black/60">Location</dt>
              <dd className="truncate text-xs font-extrabold">{d.city ? label(d.city) : "—"}</dd>
            </div>
          </dl>

          {detail?.seen_via && detail.seen_via.length > 1 && (
            <div className="mt-4">
              <p className="blabel text-[10px] text-black/60">Also seen on_</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {detail.seen_via.map((s) => (
                  <span key={`${s.source}-${s.url}`} className="bchip bg-black text-[#ffd400]">{s.source}</span>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4">
            <p className="blabel text-[10px] text-black/60">Full description_</p>
            {loading ? (
              <div className="mt-2 space-y-2">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-3 animate-pulse border-2 border-black/20 bg-black/10" />
                ))}
              </div>
            ) : error ? (
              <div className="mt-2 border-2 border-black bg-[#ff3b30] px-3 py-2 text-xs font-bold text-white">
                !! {error} —{" "}
                <button className="underline underline-offset-2" onClick={fetchDetail}>RETRY</button>
              </div>
            ) : (
              <DescriptionBody text={detail?.description || d.description_snippet || ""} />
            )}
          </div>
        </div>

        {/* footer */}
        <div className="flex flex-col gap-2 border-t-3 border-black bg-[#f4f1ea] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p className="blabel text-[10px] text-black/60">
            {signedIn ? "APPLY DIRECTLY AT THE SOURCE" : "SIGN IN TO UNLOCK THE APPLY LINK"}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button onClick={onClose} className="bbtn px-3 py-2 text-xs">Close</button>
            {applyUrl ? (
              <a href={applyUrl} target="_blank" rel="noopener noreferrer" className="bbtn bbtn-green px-4 py-2 text-xs">
                Apply at source ↗
              </a>
            ) : (
              <Link href="/login" className="bbtn bbtn-green px-4 py-2 text-xs">Sign in to apply ↗</Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}