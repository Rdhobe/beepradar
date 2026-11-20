"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase, supabaseConfigured } from "@/lib/supabase/client";

interface QuotaRow { n: number; per: string; hard?: boolean }
interface TokenEntry { token?: string; company?: string; url?: string }
interface SecretStatus { set: boolean; source: "db" | "env" | null; masked: string | null }
interface IntegrationInfo {
  category: string;
  state: "off" | "available" | "connected" | "needs_connection";
  required_keys: string[];
  key_status: Record<string, SecretStatus>;
  boards: number;
}
interface AdminSource {
  id: string; name: string; group: string; priority: number; enabled: boolean; status: string;
  custom: boolean;
  api: {
    adapter?: string; base_url?: string; method?: string;
    auth?: { env?: string[]; in?: string; name?: string; secret?: string };
    headers?: Record<string, string>; query?: Record<string, string>; body?: unknown;
    response?: { root?: string; fields?: Record<string, string>; pagination?: Record<string, unknown> };
    known_india_tokens?: (string | TokenEntry)[]; feeds?: string[]; pages?: string[];
  };
  limits: { level: string; quotas: QuotaRow[] };
  schedule: { cron: string; max_requests_per_run: number; daily_budget?: number; monthly_budget?: number; request_delay_s?: number };
  state: { last_status: string | null; last_run_at: string | null; next_due_at: string | null; backoff_until: string | null } | null;
  quota_today: number;
  quota_left: number;
  integration?: IntegrationInfo;
}
interface SecretOverview extends SecretStatus { name: string; used_by: string[] }
interface TaggingConfig {
  mode: "free" | "llm"; provider: string; model: string; batch_size: number;
  key_env: string; api_key_present: boolean; key_source: "db" | "env" | null;
  key_masked: string | null; master_key_present: boolean;
}
interface ProviderOption { id: string; label: string; keyEnv: string; defaultModel: string; models: string[] }
interface Tagging {
  counts: Record<string, number>;
  recent_runs: {
    id: number; ran_at: string; model: string; batch_size: number;
    input_tokens: number; output_tokens: number; cached_input_tokens: number;
    latency_ms: number; ok: boolean; error: string | null;
  }[];
  config: TaggingConfig;
  providers: ProviderOption[];
}
interface TagDraft { mode: "free" | "llm"; provider: string; model: string; api_key: string }
interface HttpDraft {
  url: string; method: string; auth_in: string; auth_name: string; secret: string;
  headers: string; query: string; body: string;
  root: string; f_title: string; f_url: string; f_company: string; f_location: string;
  f_description: string; f_posted_at: string; f_id: string;
  pag_type: string; pag_param: string; pag_start: number; pag_step: number; pag_max: number;
}
interface Draft {
  id: string; name: string; adapter: string; group: string; priority: number; enabled: boolean;
  cron: string; max_requests_per_run: number; request_delay_s: number;
  daily_budget: string; monthly_budget: string;
  quotas: QuotaRow[]; token_lines: string; notes: string; http: HttpDraft;
}
interface TestResult {
  status: number; ok: boolean; url: string; content_type: string | null;
  preview: string; roots: { path: string; count: number; sample_keys: string[] }[];
  sample: { title: string; url: string; company: string }[];
}
interface RunLogRow {
  source: string; started_at: string; finished_at: string | null;
  fetched: number | null; passed_filter: number | null; inserted: number | null;
  dup_url: number | null; dup_fingerprint: number | null; dup_fuzzy: number | null;
  error: string | null;
}
interface RunLog { running: { source: string; since: string | null }[]; runs: RunLogRow[] }

const ADAPTER_OPTIONS: { id: string; label: string; kind: "tokens" | "urls" | "rss" | "pages" | "base_url" | "custom"; hint: string }[] = [
  { id: "custom_http", label: "Custom HTTP API (any JSON endpoint)", kind: "custom", hint: "Point at any JSON jobs API and map the response fields" },
  { id: "greenhouse", label: "Greenhouse board", kind: "tokens", hint: "One board slug per line, e.g. aspora — or slug|Company Name" },
  { id: "lever", label: "Lever board", kind: "tokens", hint: "One board slug per line, e.g. somecompany" },
  { id: "ashby", label: "Ashby board", kind: "tokens", hint: "One job-board name per line, e.g. aspora" },
  { id: "smartrecruiters", label: "SmartRecruiters", kind: "tokens", hint: "One company identifier per line" },
  { id: "recruitee", label: "Recruitee", kind: "tokens", hint: "One company slug per line" },
  { id: "personio", label: "Personio (XML)", kind: "tokens", hint: "One company slug per line" },
  { id: "teamtailor", label: "Teamtailor", kind: "tokens", hint: "One company slug per line" },
  { id: "workable", label: "Workable", kind: "tokens", hint: "One account slug per line" },
  { id: "polymer", label: "Polymer", kind: "tokens", hint: "One organization slug per line" },
  { id: "breezy", label: "Breezy (verified URL)", kind: "urls", hint: "One full API URL per line: url|Company Name" },
  { id: "bamboohr", label: "BambooHR (verified URL)", kind: "urls", hint: "One full API URL per line: url|Company Name" },
  { id: "pinpoint", label: "Pinpoint (verified URL)", kind: "urls", hint: "One full API URL per line: url|Company Name" },
  { id: "rippling_ats", label: "Rippling ATS (verified URL)", kind: "urls", hint: "One full API URL per line: url|Company Name" },
  { id: "comeet", label: "Comeet (verified URL)", kind: "urls", hint: "One full API URL per line: url|Company Name" },
  { id: "jazzhr", label: "JazzHR (verified URL)", kind: "urls", hint: "One full XML URL per line: url|Company Name" },
  { id: "oracle_recruiting", label: "Oracle Recruiting (verified URL)", kind: "urls", hint: "One full API URL per line: url|Company Name" },
  { id: "workday_cxs", label: "Workday CXS", kind: "urls", hint: "One tenant CXS URL per line: https://tenant.wd1.myworkdayjobs.com/wday/cxs/tenant/site/jobs|Company" },
  { id: "weworkremotely_rss", label: "RSS feed", kind: "rss", hint: "Up to 3 feed URLs, one per line" },
  { id: "jsonld_careers", label: "Career page (JSON-LD)", kind: "pages", hint: "Career page URLs with JobPosting structured data, one per line. robots.txt is respected." },
  { id: "generic_json", label: "Generic JSON API", kind: "base_url", hint: "One URL returning a JSON jobs array (jobs/positions/data/items…)" },
];

const KIND_BY_ADAPTER = Object.fromEntries(ADAPTER_OPTIONS.map((a) => [a.id, a.kind]));
const WINDOWS = ["minute", "hour", "day", "week", "month"];
const CATEGORY_ORDER = ["ATS boards", "Feeds", "Career pages", "Community", "Job APIs", "Custom"];
const AUTH_IN_OPTIONS = ["none", "header", "query", "bearer", "basic"];

const STATE_CHIP: Record<string, { label: string; cls: string }> = {
  available: { label: "AVAILABLE", cls: "bg-[#00a651] text-white" },
  connected: { label: "CONNECTED", cls: "bg-[#2400ff] text-white" },
  needs_connection: { label: "NEEDS KEY", cls: "bg-[#ff3b30] text-white" },
  off: { label: "OFF", cls: "bg-white text-black/50" },
};

function dt(s: string | null | undefined): string {
  return s ? new Date(s).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "—";
}

function hms(s: string | null | undefined): string {
  return s ? new Date(s).toISOString().slice(11, 19) : "--:--:--";
}

function emptyHttp(): HttpDraft {
  return {
    url: "", method: "GET", auth_in: "none", auth_name: "", secret: "",
    headers: "", query: "", body: "",
    root: "", f_title: "title", f_url: "url", f_company: "", f_location: "",
    f_description: "", f_posted_at: "", f_id: "",
    pag_type: "none", pag_param: "page", pag_start: 1, pag_step: 100, pag_max: 1,
  };
}

function emptyDraft(): Draft {
  return {
    id: "", name: "", adapter: "custom_http", group: "G4_etiquette_low_frequency", priority: 50, enabled: true,
    cron: "0 */6 * * *", max_requests_per_run: 10, request_delay_s: 3,
    daily_budget: "", monthly_budget: "",
    quotas: [{ n: 60, per: "hour" }, { n: 200, per: "day" }],
    token_lines: "", notes: "", http: emptyHttp(),
  };
}

function httpFrom(s: AdminSource): HttpDraft {
  const api = s.api;
  const r = api.response ?? {};
  const f = r.fields ?? {};
  const p = (r.pagination ?? {}) as Record<string, any>;
  return {
    url: api.base_url ?? "", method: api.method === "POST" ? "POST" : "GET",
    auth_in: api.auth?.in ?? "none", auth_name: api.auth?.name ?? "", secret: api.auth?.secret ?? api.auth?.env?.[0] ?? "",
    headers: api.headers && Object.keys(api.headers).length ? JSON.stringify(api.headers, null, 2) : "",
    query: api.query && Object.keys(api.query).length ? JSON.stringify(api.query, null, 2) : "",
    body: api.body != null ? JSON.stringify(api.body, null, 2) : "",
    root: r.root ?? "", f_title: f.title ?? "title", f_url: f.url ?? "url",
    f_company: f.company ?? "", f_location: f.location ?? "", f_description: f.description ?? "",
    f_posted_at: f.posted_at ?? "", f_id: f.id ?? "",
    pag_type: p.type ?? "none", pag_param: p.param ?? "page", pag_start: p.start ?? 1, pag_step: p.step ?? 100, pag_max: p.max_pages ?? 1,
  };
}

function draftFrom(s: AdminSource): Draft {
  const adapter = (s.api.adapter as string) || s.id;
  const kind = KIND_BY_ADAPTER[adapter];
  let lines = "";
  if (kind === "tokens" || kind === "urls") {
    lines = (s.api.known_india_tokens ?? []).map((e) => {
      if (typeof e === "string") return e;
      if (kind === "urls") return [e.url, e.company].filter(Boolean).join("|");
      return [e.token, e.company].filter(Boolean).join("|");
    }).join("\n");
  } else if (kind === "rss") lines = (s.api.feeds ?? []).join("\n");
  else if (kind === "pages") lines = (s.api.pages ?? []).join("\n");
  else if (kind === "base_url") lines = s.api.base_url ?? "";
  return {
    id: s.id, name: s.name, adapter, group: s.group, priority: s.priority, enabled: s.enabled,
    cron: s.schedule.cron, max_requests_per_run: s.schedule.max_requests_per_run,
    request_delay_s: s.schedule.request_delay_s ?? 3,
    daily_budget: s.schedule.daily_budget != null ? String(s.schedule.daily_budget) : "",
    monthly_budget: s.schedule.monthly_budget != null ? String(s.schedule.monthly_budget) : "",
    quotas: s.limits.quotas.map((q) => ({ n: q.n ?? 0, per: q.per, hard: !!q.hard })),
    token_lines: lines, notes: "",
    http: adapter === "custom_http" ? httpFrom(s) : emptyHttp(),
  };
}

function httpPayload(h: HttpDraft): { payload?: Record<string, unknown>; error?: string } {
  const objs: Record<string, unknown> = {};
  for (const k of ["headers", "query", "body"] as const) {
    const t = h[k].trim();
    if (!t) { objs[k] = {}; continue; }
    try {
      const v = JSON.parse(t);
      if (!v || typeof v !== "object" || Array.isArray(v)) return { error: `${k} must be a JSON object` };
      objs[k] = v;
    } catch {
      return { error: `${k} is not valid JSON` };
    }
  }
  const fields: Record<string, string> = { title: h.f_title, url: h.f_url };
  for (const [k, v] of [["company", h.f_company], ["location", h.f_location], ["description", h.f_description], ["posted_at", h.f_posted_at], ["id", h.f_id]] as const) {
    if (v.trim()) fields[k] = v.trim();
  }
  const pagination: Record<string, unknown> = { type: h.pag_type };
  if (h.pag_type !== "none") {
    pagination.param = h.pag_param; pagination.max_pages = Number(h.pag_max);
    if (h.pag_type === "page") pagination.start = Number(h.pag_start);
    if (h.pag_type === "offset") pagination.step = Number(h.pag_step);
  }
  return {
    payload: {
      url: h.url, method: h.method, auth_in: h.auth_in, auth_name: h.auth_name, secret: h.secret,
      ...objs,
      response: { root: h.root, fields, pagination },
    },
  };
}

export default function AdminPage() {
  const [auth, setAuth] = useState<"loading" | "anon" | "denied" | "ok" | "error">("loading");
  const [email, setEmail] = useState("");
  const [sources, setSources] = useState<AdminSource[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [secrets, setSecrets] = useState<SecretOverview[]>([]);
  const [masterKey, setMasterKey] = useState(true);
  const [tagging, setTagging] = useState<Tagging | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [form, setForm] = useState<{ mode: "add" } | { mode: "edit"; source: AdminSource } | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [connectFor, setConnectFor] = useState<AdminSource | null>(null);
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [showTable, setShowTable] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [batches, setBatches] = useState(10);
  const [tagCfgOpen, setTagCfgOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState<TagDraft>({ mode: "free", provider: "groq", model: "openai/gpt-oss-20b", api_key: "" });
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [runlog, setRunlog] = useState<RunLog>({ running: [], runs: [] });
  const [logBaseline, setLogBaseline] = useState<Set<string> | null>(null);
  const [statusAt, setStatusAt] = useState<Date | null>(null);
  const [tagLogBaseline, setTagLogBaseline] = useState<Set<number> | null>(null);
  const [tagEvents, setTagEvents] = useState<{ id: number; at: string; text: string; kind: "ok" | "err" }[]>([]);
  const tagEventId = useRef(0);
  const ingestBusy = busy !== null && (busy === "tick" || busy === "bulk" || busy === "readybulk" || busy.startsWith("run:"));
  const TAG_ACTION_KEYS = ["tag", "retry", "retag", "reapply"];
  const taggingBusy = busy !== null && (TAG_ACTION_KEYS.includes(busy) || busy === "tagcfg");
  const shownTagRuns = tagLogBaseline == null
    ? (tagging?.recent_runs ?? [])
    : (tagging?.recent_runs ?? []).filter((r) => !tagLogBaseline.has(r.id));

  function pushTagEvent(text: string, kind: "ok" | "err") {
    tagEventId.current += 1;
    setTagEvents((prev) => [{ id: tagEventId.current, at: new Date().toISOString(), text, kind }, ...prev].slice(0, 40));
  }
  // A new run starts a fresh log session: runs already on screen at click time are
  // baselined out (by identity, not clock) so only this run's entries show.
  const runKey = (r: RunLogRow) => `${r.source}|${r.started_at}`;
  const shownLog: RunLog = logBaseline == null ? runlog : {
    running: runlog.running,
    runs: runlog.runs.filter((r) => !logBaseline.has(runKey(r))),
  };
  const beginIngestLog = async () => {
    // Provisional baseline from what's on screen, then union with server truth so
    // history that hadn't loaded yet at click time is baselined out too.
    setLogBaseline(new Set(runlog.runs.map(runKey)));
    setRunlog({ running: [], runs: [] });
    const r = await adminFetch("/api/admin/runlog");
    if (r && r.ok) {
      const j: RunLog = await r.json();
      setLogBaseline((prev) => {
        const next = new Set(prev ?? []);
        for (const row of j.runs) next.add(runKey(row));
        return next;
      });
    }
  };

  const adminFetch = useCallback(async (path: string, init?: RequestInit): Promise<Response | null> => {
    const sb = getSupabase();
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) { setAuth("anon"); return null; }
    const resp = await fetch(path, {
      ...init,
      headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}`, ...(init?.body ? { "Content-Type": "application/json" } : {}) },
      signal: AbortSignal.timeout(60000),
    });
    if (resp.status === 401) { setAuth("denied"); return null; }
    return resp;
  }, []);

  const beginTagLog = async () => {
    setTagLogBaseline(new Set((tagging?.recent_runs ?? []).map((r) => r.id)));
    const r = await adminFetch("/api/admin/tagging");
    if (r && r.ok) {
      const j: Tagging = await r.json();
      setTagLogBaseline((prev) => {
        const next = new Set(prev ?? []);
        for (const row of j.recent_runs) next.add(row.id);
        return next;
      });
    }
  };

  const load = useCallback(async () => {
    try {
      const [sResp, tResp, lResp] = await Promise.all([
        adminFetch("/api/admin/sources"), adminFetch("/api/admin/tagging"), adminFetch("/api/admin/runlog"),
      ]);
      if (!sResp || !tResp) return;
      if (!sResp.ok || !tResp.ok) { setAuth("error"); return; }
      const sData = await sResp.json();
      setSources(sData.sources);
      setGroups(sData.groups);
      setEmail(sData.email);
      setSecrets(sData.secrets ?? []);
      setMasterKey(sData.master_key_present !== false);
      setTagging(await tResp.json());
      if (lResp && lResp.ok) setRunlog(await lResp.json());
      setAuth("ok");
    } catch {
      setAuth("error");
    }
  }, [adminFetch]);

  useEffect(() => {
    if (!supabaseConfigured()) { setAuth("anon"); return; }
    load();
  }, [load]);

  useEffect(() => {
    if (!ingestBusy) return;
    let alive = true;
    const pull = async () => {
      const r = await adminFetch("/api/admin/runlog");
      if (r && r.ok) {
        const j = await r.json();
        if (alive) setRunlog(j);
      }
    };
    pull();
    const iv = setInterval(pull, 2000);
    return () => { alive = false; clearInterval(iv); };
  }, [ingestBusy, adminFetch]);

  // Keep the sticky status stamp fresh for every success / error.
  useEffect(() => { if (banner) setStatusAt(new Date()); }, [banner]);

  // Per-batch tagging rows land in llm_runs while a tagging action is running.
  useEffect(() => {
    if (!taggingBusy) return;
    let alive = true;
    const pull = async () => {
      const r = await adminFetch("/api/admin/tagging");
      if (r && r.ok) {
        const j: Tagging = await r.json();
        if (alive) setTagging(j);
      }
    };
    pull();
    const iv = setInterval(pull, 2000);
    return () => { alive = false; clearInterval(iv); };
  }, [taggingBusy, adminFetch]);

  // Modals can always be dismissed with Escape, even while a run is streaming.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setConnectFor(null);
      setTagCfgOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function runAction(key: string, path: string, body: unknown, summarize: (j: any) => string): Promise<boolean> {
    if (key === "tick" || key.startsWith("run:")) await beginIngestLog();
    if (TAG_ACTION_KEYS.includes(key)) await beginTagLog();
    setBusy(key);
    setBanner(null);
    const report = (kind: "ok" | "err", text: string) => {
      setBanner({ kind, text });
      if (TAG_ACTION_KEYS.includes(key)) pushTagEvent(text, kind);
    };
    try {
      const resp = await adminFetch(path, { method: "POST", body: JSON.stringify(body ?? {}) });
      if (!resp) return false;
      const j = await resp.json();
      if (!resp.ok) { report("err", j.error ?? `Request failed (${resp.status})`); return false; }
      report("ok", summarize(j));
      await load();
      return true;
    } catch (e) {
      report("err", e instanceof Error && e.name === "TimeoutError" ? "Request timed out (60s limit)" : String(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  // Bulk runs are chunked server-side (maxSources per call). Resume still_due
  // across short POSTs with a gap so the transaction pooler is never saturated
  // by one long request.
  async function runChunked(key: string, initialIds: string[], done: (ran: any[], skipped: any[]) => string) {
    await beginIngestLog();
    setBusy(key);
    setBanner(null);
    let ids = initialIds;
    const ran: any[] = [];
    const skipped: any[] = [];
    try {
      for (let guard = 0; ids.length && guard < 15; guard++) {
        const resp = await adminFetch("/api/admin/run", { method: "POST", body: JSON.stringify({ source_ids: ids }) });
        if (!resp) return;
        const j = await resp.json();
        if (!resp.ok) { setBanner({ kind: "err", text: j.error ?? `Request failed (${resp.status})` }); return; }
        ran.push(...(j.ran ?? []));
        skipped.push(...(j.skipped ?? []));
        ids = j.still_due ?? [];
        if (ids.length) {
          setBanner({ kind: "ok", text: `Chunk done — ran ${ran.length}, ${ids.length} still queued. Continuing (quota-aware, never all at once)…` });
          await new Promise((r) => setTimeout(r, 700));
        }
      }
      setBanner({ kind: "ok", text: done(ran, skipped) + (ids.length ? ` // ${ids.length} still queued — click again to resume` : "") });
      await load();
    } catch (e) {
      setBanner({ kind: "err", text: e instanceof Error && e.name === "TimeoutError" ? "Request timed out (60s limit)" : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function saveForm() {
    if (!form) return;
    const adapterKind = KIND_BY_ADAPTER[draft.adapter];
    const schedule: Record<string, unknown> = {
      cron: draft.cron, max_requests_per_run: Number(draft.max_requests_per_run), request_delay_s: Number(draft.request_delay_s),
    };
    if (draft.daily_budget.trim()) schedule.daily_budget = Number(draft.daily_budget);
    if (draft.monthly_budget.trim()) schedule.monthly_budget = Number(draft.monthly_budget);
    const quotas = draft.quotas.filter((q) => q.n > 0);

    let http: Record<string, unknown> | undefined;
    if (adapterKind === "custom") {
      const r = httpPayload(draft.http);
      if (r.error) { setBanner({ kind: "err", text: r.error }); return; }
      http = r.payload;
    }

    setBusy("save");
    setBanner(null);
    try {
      let resp: Response | null;
      if (form.mode === "add") {
        resp = await adminFetch("/api/admin/sources", {
          method: "POST",
          body: JSON.stringify({
            id: draft.id, name: draft.name, adapter: draft.adapter, group: draft.group, priority: Number(draft.priority),
            ...schedule, quotas, token_lines: draft.token_lines, notes: draft.notes,
            ...(http ? { http } : {}),
          }),
        });
      } else {
        const body: Record<string, unknown> = {
          enabled: draft.enabled, priority: Number(draft.priority), schedule, limits: { quotas },
        };
        if (adapterKind === "custom") body.api = { http_config: http };
        else if (adapterKind) body.api = { token_lines: draft.token_lines, adapter_hint: draft.adapter };
        resp = await adminFetch(`/api/admin/sources/${form.source.id}`, { method: "PATCH", body: JSON.stringify(body) });
      }
      if (!resp) return;
      const j = await resp.json();
      if (!resp.ok) setBanner({ kind: "err", text: j.error ?? `Save failed (${resp.status})` });
      else {
        setBanner({ kind: "ok", text: form.mode === "add" ? `Integration ${draft.id} created` : `Integration ${form.source.id} updated` });
        setForm(null);
        setTestResult(null);
        await load();
      }
    } catch (e) {
      setBanner({ kind: "err", text: String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function testFetch() {
    const r = httpPayload(draft.http);
    if (r.error) { setBanner({ kind: "err", text: r.error }); return; }
    setBusy("test");
    setBanner(null);
    setTestResult(null);
    try {
      const resp = await adminFetch("/api/admin/test-fetch", { method: "POST", body: JSON.stringify(r.payload) });
      if (!resp) return;
      const j = await resp.json();
      if (!resp.ok) setBanner({ kind: "err", text: j.error ?? `Test failed (${resp.status})` });
      else setTestResult(j);
    } catch (e) {
      setBanner({ kind: "err", text: String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function saveKeys() {
    if (!connectFor) return;
    const entries = Object.entries(keyDrafts).filter(([, v]) => v.trim());
    if (!entries.length) { setBanner({ kind: "err", text: "Enter at least one key value" }); return; }
    setBusy("keys");
    setBanner(null);
    try {
      const errors: string[] = [];
      for (const [name, value] of entries) {
        const resp = await adminFetch("/api/admin/secrets", { method: "POST", body: JSON.stringify({ name, value: value.trim() }) });
        if (!resp) return;
        const j = await resp.json();
        if (!resp.ok) errors.push(`${name}: ${j.error ?? resp.status}`);
      }
      if (errors.length) setBanner({ kind: "err", text: errors.join(" // ") });
      else {
        setBanner({ kind: "ok", text: `Saved ${entries.length} key(s) — encrypted at rest` });
        setConnectFor(null);
        setKeyDrafts({});
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function removeKey(name: string) {
    if (!confirm(`Remove stored key ${name}? Integrations using it will need reconnection (env fallback still applies if set).`)) return;
    setBusy(`delkey:${name}`);
    try {
      const resp = await adminFetch(`/api/admin/secrets/${name}`, { method: "DELETE" });
      if (!resp) return;
      const j = await resp.json();
      setBanner(resp.ok ? { kind: "ok", text: `Removed ${name}` } : { kind: "err", text: j.error ?? "Delete failed" });
      if (resp.ok) await load();
    } finally {
      setBusy(null);
    }
  }

  async function toggleEnabled(s: AdminSource) {
    setBusy(`tog:${s.id}`);
    setBanner(null);
    try {
      const resp = await adminFetch(`/api/admin/sources/${s.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !s.enabled }) });
      if (!resp) return;
      const j = await resp.json();
      if (!resp.ok) setBanner({ kind: "err", text: j.error ?? "Toggle failed" });
      else { setBanner({ kind: "ok", text: `${s.id} ${s.enabled ? "disabled" : "enabled"}` }); await load(); }
    } finally {
      setBusy(null);
    }
  }

  async function removeSource(s: AdminSource) {
    if (!confirm(`Delete custom integration "${s.id}"? Its already-ingested jobs stay in the database.`)) return;
    setBusy(`del:${s.id}`);
    try {
      const resp = await adminFetch(`/api/admin/sources/${s.id}`, { method: "DELETE" });
      if (!resp) return;
      const j = await resp.json();
      setBanner(resp.ok ? { kind: "ok", text: `Deleted ${s.id}` } : { kind: "err", text: j.error ?? "Delete failed" });
      if (resp.ok) await load();
    } finally {
      setBusy(null);
    }
  }

  function openConnect(s: AdminSource) {
    setForm(null);
    setConnectFor(s);
    setKeyDrafts(Object.fromEntries((s.integration?.required_keys ?? []).map((k) => [k, ""])));
  }

  function openEdit(s: AdminSource) {
    setConnectFor(null);
    setTestResult(null);
    setDraft(draftFrom(s));
    setForm({ mode: "edit", source: s });
  }

  function openTagConfig() {
    const c = tagging?.config;
    setTagDraft({ mode: c?.mode ?? "free", provider: c?.provider ?? "groq", model: c?.model ?? "openai/gpt-oss-20b", api_key: "" });
    setTagCfgOpen(true);
  }

  async function saveTagConfig() {
    setBusy("tagcfg");
    setBanner(null);
    try {
      const resp = await adminFetch("/api/admin/tagging", {
        method: "POST",
        body: JSON.stringify({
          mode: tagDraft.mode, provider: tagDraft.provider, model: tagDraft.model,
          ...(tagDraft.api_key.trim() ? { api_key: tagDraft.api_key.trim() } : {}),
        }),
      });
      if (!resp) return;
      const j = await resp.json();
      if (!resp.ok) {
        const text = j.error ?? `Save failed (${resp.status})`;
        setBanner({ kind: "err", text });
        pushTagEvent(text, "err");
        return;
      }
      const text = `Tagging saved — ${tagDraft.mode === "free" ? "FREE RULES" : `${tagDraft.provider.toUpperCase()} · ${tagDraft.model}`}${tagDraft.api_key.trim() ? " · KEY ENCRYPTED" : ""}`;
      setBanner({ kind: "ok", text });
      pushTagEvent(text, "ok");
      setTagCfgOpen(false);
      setTagDraft((d) => ({ ...d, api_key: "" }));
      await load();
    } catch (e) {
      const text = String(e);
      setBanner({ kind: "err", text });
      pushTagEvent(text, "err");
    } finally {
      setBusy(null);
    }
  }

  if (!supabaseConfigured()) {
    return (
      <div className="bcard bg-[#ffd400] p-6">
        <p className="blabel text-sm">!! SUPABASE NOT CONFIGURED</p>
        <p className="mt-2 text-sm">Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to use the admin panel.</p>
      </div>
    );
  }
  if (auth === "loading") return <div className="h-64 animate-pulse border-3 border-black bg-black/10 shadow-[6px_6px_0_#000]" />;
  if (auth === "anon") {
    return (
      <div className="bcard p-8 text-center">
        <p className="text-2xl font-black uppercase">Sign in required_</p>
        <p className="blabel mt-2 text-xs text-black/60">THE ADMIN PANEL NEEDS AN ADMIN ACCOUNT</p>
        <Link href="/login" className="bbtn bbtn-yellow mt-6 px-4 py-2 text-xs">Sign in →</Link>
      </div>
    );
  }
  if (auth === "denied") {
    return (
      <div className="bcard bg-[#ff3b30] p-6 text-white">
        <p className="blabel text-sm">!! ACCESS DENIED</p>
        <p className="mt-2 text-sm font-medium">
          Your account is not an admin. Add your email to the <code className="bg-black px-1 text-[#ffd400]">ADMIN_EMAILS</code> env var
          (comma-separated), redeploy/restart, then refresh this page.
        </p>
      </div>
    );
  }
  if (auth === "error") {
    return (
      <div className="bcard bg-[#ff3b30] p-6 text-white">
        <p className="blabel text-sm">!! COULD NOT LOAD ADMIN DATA</p>
        <p className="mt-2 text-sm font-medium">
          The database may be unreachable or the request timed out. If you just changed <code className="bg-black px-1 text-[#ffd400]">DATABASE_URL</code>,
          fully restart the dev server (the DB client is cached per process), then retry.
        </p>
        <button className="bbtn bbtn-yellow mt-4 px-4 py-2 text-xs" onClick={() => { setAuth("loading"); load(); }}>
          Retry
        </button>
      </div>
    );
  }

  const adapterKind = KIND_BY_ADAPTER[draft.adapter];
  const adapterHint = ADAPTER_OPTIONS.find((a) => a.id === draft.adapter)?.hint;
  const pending = tagging?.counts?.pending ?? 0;
  const failed = tagging?.counts?.failed ?? 0;
  const done = tagging?.counts?.done ?? 0;
  const tagMode = tagging?.config.mode ?? "free";
  const tagProviders = tagging?.providers ?? [];
  const draftProvider = tagProviders.find((p) => p.id === tagDraft.provider);

  const byCategory = new Map<string, AdminSource[]>();
  for (const s of sources) {
    const cat = s.integration?.category ?? "Job APIs";
    byCategory.set(cat, [...(byCategory.get(cat) ?? []), s]);
  }
  const counts = { available: 0, connected: 0, needs_connection: 0, off: 0 };
  for (const s of sources) counts[s.integration?.state ?? "off"]++;

  const isRunnable = (s: AdminSource) =>
    s.enabled && (s.integration?.state === "available" || s.integration?.state === "connected");
  const runnableIds = sources.filter(isRunnable).map((s) => s.id);
  const knownIds = new Set(sources.map((s) => s.id));
  const selectedIds = Object.keys(selected).filter((id) => selected[id] && knownIds.has(id));
  const toggleSelect = (id: string) => setSelected((p) => ({ ...p, [id]: !p[id] }));
  const selectAllRunnable = () => setSelected(Object.fromEntries(runnableIds.map((id) => [id, true])));
  const clearSelection = () => setSelected({});
  const bulkDone = (ran: any[], skipped: any[]) =>
    `Ran ${ran.length} source(s): ` +
    (ran.map((r) => `${r.source}=${r.status}${r.inserted != null ? `(+${r.inserted})` : ""}`).join(", ") || "none") +
    (skipped.length ? ` // skipped ${skipped.length}: ${skipped.map((s) => `${s.source}(${s.reason})`).join(", ")}` : "");
  const runBulk = async () => {
    await runChunked("bulk", selectedIds, bulkDone);
    clearSelection();
  };

  const now = new Date();
  const inBackoff = (s: AdminSource) => !!s.state?.backoff_until && new Date(s.state.backoff_until) > now;
  const isDue = (s: AdminSource) => !s.state?.next_due_at || new Date(s.state.next_due_at) <= now;
  const cooling = (s: AdminSource) => !isDue(s);
  const cooldownLeft = (s: AdminSource) => {
    if (!s.state?.next_due_at) return "";
    const ms = new Date(s.state.next_due_at).getTime() - now.getTime();
    if (ms <= 0) return "";
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };
  const ready = sources
    .filter((s) => isRunnable(s) && (s.quota_left ?? 0) > 0 && !inBackoff(s) && isDue(s))
    .sort((a, b) => a.priority - b.priority);
  const runReadyBulk = () => runChunked("readybulk", ready.map((s) => s.id), bulkDone);

  const runSummary = (s: AdminSource) => (j: any) =>
    `${s.id}: ${j.result?.status}${j.result?.inserted != null ? ` — fetched ${j.result.fetched}, inserted ${j.result.inserted}, dups ${(j.result.dup_url ?? 0) + (j.result.dup_fingerprint ?? 0) + (j.result.dup_fuzzy ?? 0)}` : ""}${j.result?.error ? ` — ${j.result.error}` : ""}`;

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="bchip inline-block -rotate-1 bg-black text-[#ffd400]">ADMIN_</span>
          <h1 className="mt-3 text-3xl font-black uppercase leading-none tracking-tight">Control room<span className="text-[#2400ff]">_</span></h1>
          <p className="blabel mt-2 text-[10px] text-black/60">SIGNED IN AS {email} // NO CRON — YOU DRIVE THE PIPELINE</p>
        </div>
        <div className="flex gap-3">
          <Link href="/admin/flow" className="bbtn bbtn-blue px-3 py-1.5 text-xs">Flow →</Link>
          <Link href="/admin/stats" className="bbtn px-3 py-1.5 text-xs">Stats →</Link>
          <button className="bbtn px-3 py-1.5 text-xs" onClick={() => load()} disabled={!!busy}>Refresh</button>
        </div>
      </div>

      <div className="sticky top-0 z-40 -mt-2 pt-2" aria-live="polite">
        <div className={`bcard flex flex-wrap items-center gap-3 px-4 py-2.5 ${!banner ? "bg-white" : banner.kind === "ok" ? "bg-[#00a651] text-white" : "bg-[#ff3b30] text-white"}`}>
          <span className={`bchip ${!banner ? "bg-black text-[#ffd400]" : "bg-black/25 text-white"}`}>
            {!banner ? "STATUS // IDLE" : banner.kind === "ok" ? "STATUS // OK" : "STATUS // ERROR"}
          </span>
          <span className="min-w-0 flex-1 text-xs font-bold">
            {banner ? `${banner.kind === "ok" ? "✓ " : "!! "}${banner.text}` : "No action yet — run a source, save a key, or configure tagging."}
          </span>
          {banner && statusAt && (
            <span className="blabel text-[9px] opacity-80">{hms(statusAt.toISOString())} UTC</span>
          )}
          {busy && <span className="bchip bg-black text-[#ffd400]">{busy.toUpperCase()}…</span>}
          {banner && (
            <button className="bchip cursor-pointer bg-black/25 text-white hover:bg-black/40"
              title="Dismiss status" aria-label="Dismiss status" onClick={() => setBanner(null)}>✕</button>
          )}
        </div>
      </div>

      {!masterKey && (
        <div className="bcard bg-[#ffd400] p-4">
          <p className="blabel text-xs">!! MASTER KEY MISSING</p>
          <p className="mt-1 text-xs font-medium">
            Set <code className="bg-black px-1 text-[#ffd400]">SOURCE_KEYS_SECRET</code> (64 hex chars) in the server env to save API keys
            from this portal. Keys are AES-256-GCM encrypted with it; env-var keys still work without it.
          </p>
        </div>
      )}

      <section>
        <h2 className="blabel mb-3 border-l-4 border-black pl-3 text-sm">01 // Run ingestion</h2>
        <div className="bcard flex flex-wrap items-center gap-4 p-4">
          <button
            className="bbtn bbtn-yellow px-4 py-2 text-xs"
            disabled={!!busy}
            onClick={() => runAction("tick", "/api/admin/run", {}, (j) =>
              `Tick done in ${(j.elapsed_ms / 1000).toFixed(1)}s — ran ${j.ran?.length ?? 0} source(s): ` +
              (j.ran ?? []).map((r: any) => `${r.source}=${r.status}${r.inserted != null ? `(+${r.inserted})` : ""}`).join(", ") +
              (j.still_due?.length ? ` // still due: ${j.still_due.join(", ")}` : "") +
              (j.expired ? ` // expired ${j.expired}` : ""))}>
            {busy === "tick" ? "Running… (up to 50s)" : "Run due sources →"}
          </button>
          <p className="blabel text-[10px] text-black/60">
            RUNS ONLY CONNECTED SOURCES WITH QUOTA LEFT THAT ARE OFF COOLDOWN, IN PRIORITY ORDER — NEVER ALL AT ONCE.
          </p>
        </div>

        <div className="bcard mt-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="blabel text-xs">READY QUEUE_ APIS WITH HEADROOM, OFF THE 6H COOLDOWN</p>
            <span className="bchip bg-black text-[#ffd400]">{ready.length} ready</span>
          </div>
          {ready.length === 0 ? (
            <p className="blabel mt-3 text-[10px] text-black/60">
              NOTHING READY — CONNECTED SOURCES ARE COOLING DOWN (6H AFTER EACH RUN), QUOTA-SPENT, IN BACKOFF OR DISABLED. THEY RETURN AUTOMATICALLY; CONNECT MORE KEYS TO ADD CAPACITY.
            </p>
          ) : (
            <>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {ready.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-2 border-2 border-black bg-white px-2 py-1.5">
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-black uppercase leading-tight">{s.name}</p>
                      <p className="blabel text-[9px] text-black/50">
                        P{s.priority} · {s.quota_left} req left · {isDue(s) ? "DUE NOW" : `due ${dt(s.state?.next_due_at)}`}
                      </p>
                    </div>
                    <button className="bbtn bbtn-yellow shrink-0 px-2 py-0.5 text-[10px]" disabled={!!busy}
                      onClick={() => runAction(`run:${s.id}`, "/api/admin/run", { source_id: s.id }, runSummary(s))}>
                      {busy === `run:${s.id}` ? "…" : "Run"}
                    </button>
                  </div>
                ))}
              </div>
              {ready.length > 2 && (
                <div className="mt-3 flex flex-wrap items-center gap-3 border-t-2 border-black pt-3">
                  <button className="bbtn bbtn-blue px-4 py-2 text-xs" disabled={!!busy} onClick={runReadyBulk}>
                    {busy === "readybulk" ? "Running… (up to 50s)" : `Bulk run ready (${ready.length}) →`}
                  </button>
                  <span className="blabel text-[9px] text-black/60">
                    &gt;2 APIS HAVE HEADROOM — ONE QUOTA-AWARE, PRIORITY-ORDERED CALL, NEVER ALL AT ONCE.
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        <div className="bcard mt-4 bg-black p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="blabel text-xs text-[#ffd400]">LIVE RUN LOG_</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="bchip cursor-pointer bg-white/10 text-white/70 hover:bg-white/25"
                title="Wipe the box; the next run streams fresh entries"
                onClick={() => { setLogBaseline(new Set(runlog.runs.map(runKey))); setRunlog({ running: [], runs: [] }); }}>
                Clear
              </button>
              <button
                className="bchip cursor-pointer bg-white/10 text-white/70 hover:bg-white/25"
                title="Show recent history again"
                onClick={() => setLogBaseline(null)}>
                History
              </button>
              <span className="blabel text-[9px] text-white/50">
                {ingestBusy ? "STREAMING… THIS RUN ONLY" : logBaseline != null ? "THIS RUN — FINAL RESULTS" : "IDLE — SHOWING LAST RUNS"}
              </span>
            </div>
          </div>
          <div className="bscroll mt-2 max-h-64 space-y-0.5 overflow-auto border-2 border-white/20 bg-black p-2 font-mono text-[10px] leading-snug text-[#00a651]">
            {shownLog.running.map((r) => (
              <p key={`run-${r.source}`} className="text-[#ffd400]">
                ▶ {r.source} … RUNNING since {hms(r.since)}
              </p>
            ))}
            {shownLog.runs.map((r, i) => (
              <p key={`${r.source}-${r.started_at}-${i}`} className={r.error ? "text-[#ff3b30]" : r.finished_at ? "" : "text-white/70"}>
                [{hms(r.started_at)}] {r.source}{" "}
                {r.error
                  ? `ERROR ${r.error}`
                  : r.finished_at
                    ? `OK fetched=${r.fetched ?? 0} passed=${r.passed_filter ?? 0} inserted=${r.inserted ?? 0} dup=${(r.dup_url ?? 0) + (r.dup_fingerprint ?? 0) + (r.dup_fuzzy ?? 0)}`
                    : "… ingesting"}
              </p>
            ))}
            {shownLog.running.length === 0 && shownLog.runs.length === 0 && (
              <p className="text-white/50">
                {ingestBusy ? "waiting for first run row…" : "log clear — click Run / Bulk run; fresh per-source progress streams here."}
              </p>
            )}
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="blabel border-l-4 border-black pl-3 text-sm">02 // Integrations</h2>
          <div className="flex flex-wrap items-center gap-2">
            <span className="bchip bg-[#00a651] text-white">{counts.available} available</span>
            <span className="bchip bg-[#2400ff] text-white">{counts.connected} connected</span>
            <span className="bchip bg-[#ff3b30] text-white">{counts.needs_connection} need keys</span>
            <span className="bchip bg-white text-black/50">{counts.off} off</span>
            <button className="bbtn bbtn-blue px-4 py-2 text-xs" disabled={!!busy}
              onClick={() => { setConnectFor(null); setTestResult(null); setDraft(emptyDraft()); setForm({ mode: "add" }); }}>
              + Add integration
            </button>
          </div>
        </div>

        <div className="bcard mb-6 flex flex-wrap items-center gap-3 bg-white p-3">
          <span className="blabel text-[10px] text-black/60">BULK RUN_</span>
          <button className="bbtn px-3 py-1.5 text-[10px]" disabled={!!busy || runnableIds.length === 0} onClick={selectAllRunnable}>
            Select all runnable ({runnableIds.length})
          </button>
          <button className="bbtn px-3 py-1.5 text-[10px]" disabled={!!busy || selectedIds.length === 0} onClick={clearSelection}>
            Clear
          </button>
          <span className={`bchip ${selectedIds.length ? "bg-[#2400ff] text-white" : "bg-white text-black/50"}`}>
            {selectedIds.length} selected
          </span>
          <button className="bbtn bbtn-yellow px-4 py-2 text-xs" disabled={!!busy || selectedIds.length === 0} onClick={runBulk}>
            {busy === "bulk" ? "Running… (up to 50s)" : `Run selected (${selectedIds.length}) →`}
          </button>
          <span className="blabel text-[9px] text-black/50">
            SAME QUOTA-AWARE, PRIORITY-ORDERED CALL — SKIPS DISCONNECTED / BACKOFF / QUOTA-SPENT, NEVER ALL AT ONCE.
          </span>
        </div>

        {connectFor && (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
            role="dialog" aria-modal="true" aria-label={`Connect ${connectFor.name}`} onClick={() => setConnectFor(null)}>
            <div className="bcard my-8 w-full max-w-2xl border-3 border-black bg-[#2400ff] p-5 text-white shadow-[10px_10px_0_#000]"
              onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="blabel text-sm">CONNECT: {connectFor.name}_</p>
              <button className="bbtn px-2 py-1 text-[10px]" onClick={() => setConnectFor(null)}>Close ✕</button>
            </div>
            <p className="blabel mt-2 text-[10px] text-white/70">
              KEYS ARE ENCRYPTED (AES-256-GCM) BEFORE STORAGE AND SHARED BY NAME ACROSS INTEGRATIONS. WRITE-ONLY — NEVER SHOWN AGAIN.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {(connectFor.integration?.required_keys ?? []).map((k) => {
                const st = connectFor.integration?.key_status[k];
                const shared = secrets.find((x) => x.name === k)?.used_by.filter((id) => id !== connectFor.id) ?? [];
                return (
                  <div key={k}>
                    <label className="blabel block text-[10px]">
                      {k} {st?.set ? <span className="text-[#ffd400]">// SET ({st.source}) {st.masked}</span> : <span className="text-[#ff3b30]">// MISSING</span>}
                    </label>
                    <input type="password" autoComplete="off" className="binput mt-1 w-full px-2 py-1.5 text-xs text-black"
                      value={keyDrafts[k] ?? ""} placeholder={st?.set ? "leave blank to keep current" : "paste key value"}
                      onChange={(e) => setKeyDrafts({ ...keyDrafts, [k]: e.target.value })} />
                    {shared.length > 0 && (
                      <p className="blabel mt-1 text-[9px] text-white/70">ALSO USED BY: {shared.join(", ")}</p>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-5 flex gap-3">
              <button className="bbtn bbtn-yellow px-4 py-2 text-xs" disabled={!!busy || !masterKey} onClick={saveKeys}>
                {busy === "keys" ? "Encrypting…" : "Save keys →"}
              </button>
              {!masterKey && <span className="blabel self-center text-[10px] text-[#ffd400]">SET SOURCE_KEYS_SECRET FIRST</span>}
            </div>
            </div>
          </div>
        )}

        {form && (
          <div className="bcard mb-6 bg-[#ffd400] p-5">
            <div className="flex items-center justify-between">
              <p className="blabel text-sm">{form.mode === "add" ? "NEW INTEGRATION_" : `CONFIGURE: ${form.source.id}_`}</p>
              <button className="bbtn px-2 py-1 text-[10px]" onClick={() => { setForm(null); setTestResult(null); }}>Close ✕</button>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {form.mode === "add" && (
                <>
                  <div>
                    <label className="blabel block text-[10px]">ID (slug, permanent)</label>
                    <input className="binput mt-1 w-full px-2 py-1.5 text-xs" value={draft.id}
                      onChange={(e) => setDraft({ ...draft, id: e.target.value })} placeholder="my_job_api" />
                  </div>
                  <div>
                    <label className="blabel block text-[10px]">Name</label>
                    <input className="binput mt-1 w-full px-2 py-1.5 text-xs" value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Acme Jobs API" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="blabel block text-[10px]">Adapter / API type</label>
                    <select className="binput mt-1 w-full px-2 py-1.5 text-xs" value={draft.adapter}
                      onChange={(e) => setDraft({ ...draft, adapter: e.target.value })}>
                      {ADAPTER_OPTIONS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                    </select>
                  </div>
                </>
              )}
              <div>
                <label className="blabel block text-[10px]">Scarcity group</label>
                <select className="binput mt-1 w-full px-2 py-1.5 text-xs" value={draft.group}
                  onChange={(e) => setDraft({ ...draft, group: e.target.value })}>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.id}</option>)}
                </select>
              </div>
              <div>
                <label className="blabel block text-[10px]">Priority (1 = first)</label>
                <input type="number" min={1} max={99} className="binput mt-1 w-full px-2 py-1.5 text-xs" value={draft.priority}
                  onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })} />
              </div>
              <div>
                <label className="blabel block text-[10px]">Schedule cron (UTC)</label>
                <input className="binput mt-1 w-full px-2 py-1.5 text-xs" value={draft.cron}
                  onChange={(e) => setDraft({ ...draft, cron: e.target.value })} placeholder="0 */6 * * *" />
              </div>
              <div>
                <label className="blabel block text-[10px]">Max requests / run</label>
                <input type="number" min={0} max={200} className="binput mt-1 w-full px-2 py-1.5 text-xs" value={draft.max_requests_per_run}
                  onChange={(e) => setDraft({ ...draft, max_requests_per_run: Number(e.target.value) })} />
              </div>
              <div>
                <label className="blabel block text-[10px]">Delay between requests (s)</label>
                <input type="number" min={0} max={60} step={0.5} className="binput mt-1 w-full px-2 py-1.5 text-xs" value={draft.request_delay_s}
                  onChange={(e) => setDraft({ ...draft, request_delay_s: Number(e.target.value) })} />
              </div>
              <div>
                <label className="blabel block text-[10px]">Daily budget (requests, optional)</label>
                <input type="number" min={1} className="binput mt-1 w-full px-2 py-1.5 text-xs" value={draft.daily_budget}
                  onChange={(e) => setDraft({ ...draft, daily_budget: e.target.value })} placeholder="no cap" />
              </div>
              <div>
                <label className="blabel block text-[10px]">Monthly budget (requests, optional)</label>
                <input type="number" min={1} className="binput mt-1 w-full px-2 py-1.5 text-xs" value={draft.monthly_budget}
                  onChange={(e) => setDraft({ ...draft, monthly_budget: e.target.value })} placeholder="no cap" />
              </div>
              {form.mode === "edit" && (
                <div className="flex items-end gap-2 pb-1">
                  <input id="enabled" type="checkbox" checked={draft.enabled} className="h-4 w-4 accent-black"
                    onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
                  <label htmlFor="enabled" className="blabel text-[10px]">Enabled</label>
                </div>
              )}
            </div>

            <div className="mt-4">
              <label className="blabel block text-[10px]">Rate limits (enforced before every request, 80% safety margin)</label>
              <div className="mt-2 space-y-2">
                {draft.quotas.map((q, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <input type="number" min={1} className="binput w-24 px-2 py-1 text-xs" value={q.n}
                      onChange={(e) => setDraft({ ...draft, quotas: draft.quotas.map((x, j) => j === i ? { ...x, n: Number(e.target.value) } : x) })} />
                    <span className="blabel text-[10px]">per</span>
                    <select className="binput px-2 py-1 text-xs" value={q.per}
                      onChange={(e) => setDraft({ ...draft, quotas: draft.quotas.map((x, j) => j === i ? { ...x, per: e.target.value } : x) })}>
                      {WINDOWS.map((w) => <option key={w} value={w}>{w}</option>)}
                    </select>
                    <label className="blabel flex items-center gap-1 text-[10px]">
                      <input type="checkbox" checked={!!q.hard} className="h-3.5 w-3.5 accent-black"
                        onChange={(e) => setDraft({ ...draft, quotas: draft.quotas.map((x, j) => j === i ? { ...x, hard: e.target.checked } : x) })} />
                      hard cap
                    </label>
                    <button className="bbtn px-2 py-0.5 text-[10px]"
                      onClick={() => setDraft({ ...draft, quotas: draft.quotas.filter((_, j) => j !== i) })}>✕</button>
                  </div>
                ))}
                <button className="bbtn px-2 py-1 text-[10px]"
                  onClick={() => setDraft({ ...draft, quotas: [...draft.quotas, { n: 100, per: "day" }] })}>+ Add limit</button>
              </div>
            </div>

            {adapterKind && adapterKind !== "custom" && (form.mode === "add" || form.source.custom || KIND_BY_ADAPTER[form.source.id]) && (
              <div className="mt-4">
                <label className="blabel block text-[10px]">Tokens / URLs</label>
                <textarea rows={4} className="binput mt-1 w-full px-2 py-1.5 text-xs" value={draft.token_lines}
                  onChange={(e) => setDraft({ ...draft, token_lines: e.target.value })} placeholder={adapterHint} />
                <p className="blabel mt-1 text-[9px] text-black/60">{adapterHint}</p>
              </div>
            )}

            {adapterKind === "custom" && (
              <div className="mt-4 border-t-3 border-black pt-4">
                <p className="blabel text-xs">HTTP REQUEST_</p>
                <div className="mt-2 grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="blabel block text-[10px]">API URL</label>
                    <input className="binput mt-1 w-full px-2 py-1.5 text-xs" value={draft.http.url}
                      onChange={(e) => setDraft({ ...draft, http: { ...draft.http, url: e.target.value } })}
                      placeholder="https://api.example.com/v1/jobs" />
                  </div>
                  <div>
                    <label className="blabel block text-[10px]">Method</label>
                    <select className="binput mt-1 w-full px-2 py-1.5 text-xs" value={draft.http.method}
                      onChange={(e) => setDraft({ ...draft, http: { ...draft.http, method: e.target.value } })}>
                      <option>GET</option><option>POST</option>
                    </select>
                  </div>
                  <div>
                    <label className="blabel block text-[10px]">Auth style</label>
                    <select className="binput mt-1 w-full px-2 py-1.5 text-xs" value={draft.http.auth_in}
                      onChange={(e) => setDraft({ ...draft, http: { ...draft.http, auth_in: e.target.value } })}>
                      {AUTH_IN_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                  {draft.http.auth_in !== "none" && (
                    <>
                      {(draft.http.auth_in === "header" || draft.http.auth_in === "query") && (
                        <div>
                          <label className="blabel block text-[10px]">{draft.http.auth_in === "header" ? "Header name" : "Query param name"}</label>
                          <input className="binput mt-1 w-full px-2 py-1.5 text-xs" value={draft.http.auth_name}
                            onChange={(e) => setDraft({ ...draft, http: { ...draft.http, auth_name: e.target.value } })}
                            placeholder={draft.http.auth_in === "header" ? "X-Api-Key" : "api_key"} />
                        </div>
                      )}
                      <div>
                        <label className="blabel block text-[10px]">Secret key name (stored encrypted in the vault)</label>
                        <input className="binput mt-1 w-full px-2 py-1.5 text-xs" value={draft.http.secret}
                          onChange={(e) => setDraft({ ...draft, http: { ...draft.http, secret: e.target.value.toUpperCase() } })}
                          placeholder="MY_API_KEY" />
                        <p className="blabel mt-1 text-[9px] text-black/60">
                          AFTER CREATING, USE “KEYS” ON THE CARD TO ENTER THE VALUE. REUSE AN EXISTING NAME TO SHARE A KEY.
                        </p>
                      </div>
                    </>
                  )}
                  <div>
                    <label className="blabel block text-[10px]">Extra headers (JSON object, optional)</label>
                    <textarea rows={2} className="binput mt-1 w-full px-2 py-1.5 font-mono text-xs" value={draft.http.headers}
                      onChange={(e) => setDraft({ ...draft, http: { ...draft.http, headers: e.target.value } })}
                      placeholder='{"Accept": "application/json"}' />
                  </div>
                  <div>
                    <label className="blabel block text-[10px]">Query params (JSON object, optional)</label>
                    <textarea rows={2} className="binput mt-1 w-full px-2 py-1.5 font-mono text-xs" value={draft.http.query}
                      onChange={(e) => setDraft({ ...draft, http: { ...draft.http, query: e.target.value } })}
                      placeholder='{"country": "in", "limit": 50}' />
                  </div>
                  {draft.http.method === "POST" && (
                    <div className="sm:col-span-2">
                      <label className="blabel block text-[10px]">POST body (JSON object)</label>
                      <textarea rows={3} className="binput mt-1 w-full px-2 py-1.5 font-mono text-xs" value={draft.http.body}
                        onChange={(e) => setDraft({ ...draft, http: { ...draft.http, body: e.target.value } })}
                        placeholder='{"query": "software engineer", "location": "India"}' />
                    </div>
                  )}
                </div>

                <p className="blabel mt-5 text-xs">RESPONSE MAPPING_</p>
                <div className="mt-2 grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="blabel block text-[10px]">Jobs array root (dot path, blank = auto-detect)</label>
                    <input className="binput mt-1 w-full px-2 py-1.5 font-mono text-xs" value={draft.http.root}
                      onChange={(e) => setDraft({ ...draft, http: { ...draft.http, root: e.target.value } })}
                      placeholder="data.jobs" />
                    {testResult && testResult.roots.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {testResult.roots.map((r) => (
                          <button key={r.path} className={`bchip ${draft.http.root === (r.path === "(root)" ? "" : r.path) ? "bg-black text-[#ffd400]" : "bg-white"}`}
                            title={`keys: ${r.sample_keys.join(", ")}`}
                            onClick={() => setDraft({ ...draft, http: { ...draft.http, root: r.path === "(root)" ? "" : r.path } })}>
                            {r.path} ({r.count})
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {([
                    ["f_title", "title *"], ["f_url", "url *"], ["f_company", "company"], ["f_location", "location"],
                    ["f_description", "description"], ["f_posted_at", "posted_at"], ["f_id", "id"],
                  ] as const).map(([k, label]) => (
                    <div key={k}>
                      <label className="blabel block text-[10px]">Field: {label} (dot path within each job)</label>
                      <input className="binput mt-1 w-full px-2 py-1.5 font-mono text-xs" value={draft.http[k]}
                        onChange={(e) => setDraft({ ...draft, http: { ...draft.http, [k]: e.target.value } })}
                        placeholder={k === "f_title" ? "job_title" : k === "f_url" ? "apply_url" : "optional"} />
                    </div>
                  ))}
                  <div>
                    <label className="blabel block text-[10px]">Pagination</label>
                    <select className="binput mt-1 w-full px-2 py-1.5 text-xs" value={draft.http.pag_type}
                      onChange={(e) => setDraft({ ...draft, http: { ...draft.http, pag_type: e.target.value } })}>
                      <option value="none">none (single request)</option>
                      <option value="page">page number</option>
                      <option value="offset">offset</option>
                    </select>
                  </div>
                  {draft.http.pag_type !== "none" && (
                    <>
                      <div>
                        <label className="blabel block text-[10px]">Param name</label>
                        <input className="binput mt-1 w-full px-2 py-1.5 text-xs" value={draft.http.pag_param}
                          onChange={(e) => setDraft({ ...draft, http: { ...draft.http, pag_param: e.target.value } })} />
                      </div>
                      {draft.http.pag_type === "page" ? (
                        <div>
                          <label className="blabel block text-[10px]">First page number</label>
                          <input type="number" className="binput mt-1 w-full px-2 py-1.5 text-xs" value={draft.http.pag_start}
                            onChange={(e) => setDraft({ ...draft, http: { ...draft.http, pag_start: Number(e.target.value) } })} />
                        </div>
                      ) : (
                        <div>
                          <label className="blabel block text-[10px]">Offset step (page size)</label>
                          <input type="number" min={1} max={1000} className="binput mt-1 w-full px-2 py-1.5 text-xs" value={draft.http.pag_step}
                            onChange={(e) => setDraft({ ...draft, http: { ...draft.http, pag_step: Number(e.target.value) } })} />
                        </div>
                      )}
                      <div>
                        <label className="blabel block text-[10px]">Max pages (1–10)</label>
                        <input type="number" min={1} max={10} className="binput mt-1 w-full px-2 py-1.5 text-xs" value={draft.http.pag_max}
                          onChange={(e) => setDraft({ ...draft, http: { ...draft.http, pag_max: Number(e.target.value) } })} />
                      </div>
                    </>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button className="bbtn bbtn-blue px-4 py-2 text-xs" disabled={!!busy || !draft.http.url.trim()} onClick={testFetch}>
                    {busy === "test" ? "Fetching…" : "Test fetch →"}
                  </button>
                  <span className="blabel text-[9px] text-black/60">ONE LIVE REQUEST, NOTHING SAVED. USE THE RESULT TO PICK THE ROOT + FIELDS.</span>
                </div>
                {testResult && (
                  <div className="bcard mt-3 bg-white p-4">
                    <p className="blabel text-[10px]">
                      HTTP {testResult.status} {testResult.ok ? "✓" : "✕"} // {testResult.content_type ?? "?"}
                    </p>
                    <p className="mt-1 break-all font-mono text-[9px] text-black/50">{testResult.url}</p>
                    {testResult.sample.length > 0 && (
                      <div className="mt-3 border-t-2 border-black pt-2">
                        <p className="blabel text-[10px] text-[#00a651]">MAPPED SAMPLE ({testResult.sample.length})_</p>
                        {testResult.sample.map((r, i) => (
                          <p key={i} className="mt-1 text-xs">
                            <span className="font-bold">{r.title}</span> — {r.company}{" "}
                            <a href={r.url} target="_blank" rel="noreferrer" className="text-[#2400ff] underline">link</a>
                          </p>
                        ))}
                      </div>
                    )}
                    <pre className="mt-3 max-h-64 overflow-auto border-2 border-black bg-black p-2 font-mono text-[10px] leading-snug text-[#00a651]">{testResult.preview}</pre>
                  </div>
                )}
              </div>
            )}

            <div className="mt-5 flex gap-3">
              <button className="bbtn bbtn-ink px-4 py-2 text-xs" disabled={!!busy} onClick={saveForm}>
                {busy === "save" ? "Saving…" : form.mode === "add" ? "Create integration" : "Save changes"}
              </button>
              <button className="bbtn px-4 py-2 text-xs" onClick={() => { setForm(null); setTestResult(null); }}>Cancel</button>
            </div>
          </div>
        )}

        {CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((cat) => (
          <div key={cat} className="mb-6">
            <p className="blabel mb-2 text-[11px] text-black/60">{cat.toUpperCase()} ({byCategory.get(cat)!.length})</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {byCategory.get(cat)!.map((s) => {
                const info = s.integration;
                const chip = STATE_CHIP[info?.state ?? "off"];
                const runnable = isRunnable(s);
                const isSel = !!selected[s.id];
                return (
                  <div key={s.id} className={`bcard bcard-hover flex flex-col p-4 ${s.enabled ? "" : "opacity-60"} ${isSel ? "outline outline-3 outline-offset-2 outline-[#2400ff]" : ""}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        <input type="checkbox" checked={isSel} disabled={!!busy} onChange={() => toggleSelect(s.id)}
                          className="mt-0.5 h-4 w-4 shrink-0 accent-[#2400ff]" title="Select for bulk run" aria-label={`Select ${s.name}`} />
                        <div>
                          <p className="text-sm font-black uppercase leading-tight">{s.name}</p>
                          <p className="blabel mt-0.5 text-[9px] text-black/50">{s.id}{s.custom ? " // CUSTOM" : ""}</p>
                        </div>
                      </div>
                      <span className={`bchip shrink-0 ${chip.cls}`}>{chip.label}</span>
                    </div>
                    <div className="blabel mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-black/60">
                      {info && info.boards > 0 && <span>{info.boards} BOARDS/URLS</span>}
                      <span>{s.limits.quotas.map((q) => `${q.n}/${q.per}`).join(" · ")}</span>
                      <span>TODAY {s.quota_today}</span>
                      {s.state?.last_status && <span>LAST {s.state.last_status.toUpperCase()}</span>}
                    </div>
                    {s.state?.backoff_until && new Date(s.state.backoff_until) > new Date() && (
                      <span className="bchip mt-2 self-start bg-[#ff3b30] text-white">RATE-LIMIT BACKOFF</span>
                    )}
                    {cooling(s) && (
                      <span className="bchip mt-2 self-start bg-[#2400ff] text-white">COOLDOWN {cooldownLeft(s)}</span>
                    )}
                    <div className="mt-3 flex flex-wrap gap-1 border-t-2 border-black pt-3">
                      <button className={`bchip ${s.enabled ? "bg-[#00a651] text-white" : "bg-white text-black/50"}`}
                        disabled={!!busy} onClick={() => toggleEnabled(s)} title="Toggle enabled">
                        {busy === `tog:${s.id}` ? "…" : s.enabled ? "ON" : "OFF"}
                      </button>
                      <button className="bbtn bbtn-yellow px-2 py-0.5 text-[10px]" disabled={!!busy || !runnable || cooling(s)}
                        title={cooling(s) ? `Cooling down — ${cooldownLeft(s)} left` : runnable ? "Fetch now" : "Enable + connect keys first"}
                        onClick={() => runAction(`run:${s.id}`, "/api/admin/run", { source_id: s.id }, runSummary(s))}>
                        {busy === `run:${s.id}` ? "…" : cooling(s) ? "Cooling" : "Run"}
                      </button>
                      <button className="bbtn px-2 py-0.5 text-[10px]" disabled={!!busy} onClick={() => openEdit(s)}>Configure</button>
                      {info && info.required_keys.length > 0 && (
                        <button className="bbtn bbtn-blue px-2 py-0.5 text-[10px]" disabled={!!busy} onClick={() => openConnect(s)}>
                          {info.state === "connected" ? "Keys ✓" : "Connect"}
                        </button>
                      )}
                      {s.custom && (
                        <button className="bbtn px-2 py-0.5 text-[10px]" disabled={!!busy} onClick={() => removeSource(s)}>Del</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      <section>
        <h2 className="blabel mb-3 border-l-4 border-black pl-3 text-sm">03 // Keys vault ({secrets.filter((x) => x.set).length}/{secrets.length} set)</h2>
        <div className="bcard overflow-x-auto p-4">
          <p className="blabel mb-3 text-[9px] text-black/60">
            ENCRYPTED AT REST (AES-256-GCM) // SHARED BY NAME // DB KEYS OVERRIDE ENV VARS // VALUES ARE NEVER RETURNED BY THE API
          </p>
          <table className="btable min-w-full">
            <thead>
              <tr><th>Key</th><th>Status</th><th>Value</th><th>Used by</th><th></th></tr>
            </thead>
            <tbody>
              {secrets.map((k) => (
                <tr key={k.name}>
                  <td className="font-mono text-xs font-bold">{k.name}</td>
                  <td>
                    <span className={`bchip ${k.set ? (k.source === "db" ? "bg-[#2400ff] text-white" : "bg-[#00a651] text-white") : "bg-[#ff3b30] text-white"}`}>
                      {k.set ? (k.source === "db" ? "VAULT" : "ENV") : "MISSING"}
                    </span>
                  </td>
                  <td className="font-mono text-xs">{k.masked ?? "—"}</td>
                  <td className="font-mono text-[10px] text-black/60">{k.used_by.join(", ") || "—"}</td>
                  <td>
                    {k.source === "db" && (
                      <button className="bbtn px-2 py-0.5 text-[10px]" disabled={!!busy} onClick={() => removeKey(k.name)}>Remove</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="blabel border-l-4 border-black pl-3 text-sm">04 // Advanced table</h2>
          <button className="bbtn px-3 py-1.5 text-xs" onClick={() => setShowTable(!showTable)}>
            {showTable ? "Hide table" : "Show table"}
          </button>
        </div>
        {showTable && (
          <div className="overflow-x-auto pb-2 pr-2">
            <table className="btable min-w-full">
              <thead>
                <tr>
                  <th>Source</th><th>Adapter</th><th>On</th><th>Schedule</th>
                  <th>Limits / budgets</th><th>Today</th><th>State</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.id} className={s.enabled ? "" : "opacity-50"}>
                    <td>
                      <span className="font-bold">{s.name}</span>
                      <span className="blabel block text-[9px] text-black/50">{s.id}{s.custom ? " // CUSTOM" : ""}</span>
                    </td>
                    <td className="font-mono text-xs">{(s.api.adapter as string) || s.id}</td>
                    <td>
                      <button className={`bchip ${s.enabled ? "bg-[#00a651] text-white" : "bg-white text-black/50"}`}
                        disabled={!!busy} onClick={() => toggleEnabled(s)} title="Toggle enabled">
                        {s.enabled ? "ON" : "OFF"}
                      </button>
                    </td>
                    <td className="font-mono text-[10px]">
                      {s.schedule.cron}
                      <span className="blabel block text-[9px] text-black/50">max {s.schedule.max_requests_per_run}/run</span>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {s.limits.quotas.map((q, i) => (
                          <span key={i} className={`bchip ${q.hard ? "bg-[#ff3b30] text-white" : "bg-white"}`}>{q.n}/{q.per}</span>
                        ))}
                      </div>
                      {(s.schedule.daily_budget || s.schedule.monthly_budget) && (
                        <span className="blabel block text-[9px] text-black/50">
                          budget {s.schedule.daily_budget ? `${s.schedule.daily_budget}/d` : ""} {s.schedule.monthly_budget ? `${s.schedule.monthly_budget}/mo` : ""}
                        </span>
                      )}
                    </td>
                    <td className="font-mono text-xs">{s.quota_today}</td>
                    <td className="font-mono text-[10px]">
                      {s.state?.last_status ?? "—"}
                      <span className="blabel block text-[9px] text-black/50">due {dt(s.state?.next_due_at)}</span>
                      {s.state?.backoff_until && new Date(s.state.backoff_until) > new Date() && (
                        <span className="bchip mt-1 bg-[#ff3b30] text-white">backoff</span>
                      )}
                      {cooling(s) && (
                        <span className="bchip mt-1 bg-[#2400ff] text-white">cooldown {cooldownLeft(s)}</span>
                      )}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        <button className="bbtn px-2 py-0.5 text-[10px]" disabled={!!busy} onClick={() => openEdit(s)}>Edit</button>
                        <button className="bbtn bbtn-yellow px-2 py-0.5 text-[10px]" disabled={!!busy || !s.enabled || cooling(s)}
                          title={cooling(s) ? `Cooling down — ${cooldownLeft(s)} left` : "Fetch now"}
                          onClick={() => runAction(`run:${s.id}`, "/api/admin/run", { source_id: s.id }, runSummary(s))}>
                          {busy === `run:${s.id}` ? "…" : cooling(s) ? "Cooling" : "Run"}
                        </button>
                        {s.custom && (
                          <button className="bbtn px-2 py-0.5 text-[10px]" disabled={!!busy} onClick={() => removeSource(s)}>Del</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="blabel mb-3 border-l-4 border-black pl-3 text-sm">05 // Tagging — rules at ingest, LLM optional</h2>
        <div className="bcard p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="bchip bg-[#ffd400]">pending: {pending}</span>
            <span className="bchip bg-[#00a651] text-white">done: {done}</span>
            <span className="bchip bg-[#ff3b30] text-white">failed: {failed}</span>
            <span className={`bchip ${tagMode === "llm" ? "bg-[#2400ff] text-white" : "bg-[#00a651] text-white"}`}>
              {tagMode === "llm" ? "PAID LLM" : "FREE RULES"}
            </span>
            <span className="blabel text-[10px] text-black/60">
              {tagMode === "llm"
                ? `${tagging?.config.provider?.toUpperCase()} // ${tagging?.config.model} // KEY ${tagging?.config.api_key_present ? `SET (${tagging?.config.key_source})` : "MISSING"}`
                : `RULE-V1 // BATCH ${tagging?.config.batch_size} // NO KEY NEEDED`}
            </span>
            <button className="bbtn bbtn-yellow ml-auto px-3 py-1 text-[10px]" disabled={!!busy} onClick={openTagConfig}>
              Configure →
            </button>
          </div>

          {tagCfgOpen && (
            <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
              role="dialog" aria-modal="true" aria-label="Configure tagging" onClick={() => setTagCfgOpen(false)}>
            <div className="bcard my-8 w-full max-w-2xl border-3 border-black bg-[#ffd400]/95 p-5 shadow-[10px_10px_0_#000]"
              onClick={(e) => e.stopPropagation()}>
              <p className="blabel text-[10px]">TAGGING CONFIGURE_</p>
              <div className="mt-2 flex flex-wrap items-center gap-4">
                <label className="blabel flex items-center gap-1 text-[10px]">
                  <input type="radio" name="tagmode" checked={tagDraft.mode === "free"}
                    onChange={() => setTagDraft((d) => ({ ...d, mode: "free" }))} />
                  FREE (RULES)
                </label>
                <label className="blabel flex items-center gap-1 text-[10px]">
                  <input type="radio" name="tagmode" checked={tagDraft.mode === "llm"}
                    onChange={() => setTagDraft((d) => ({ ...d, mode: "llm" }))} />
                  PAID (LLM)
                </label>
              </div>
              {tagDraft.mode === "llm" && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="blabel text-[10px]">
                    PROVIDER
                    <select className="binput mt-1 w-full px-2 py-1 text-xs" value={tagDraft.provider}
                      onChange={(e) => {
                        const p = tagProviders.find((x) => x.id === e.target.value);
                        setTagDraft((d) => ({ ...d, provider: e.target.value, model: p?.defaultModel ?? d.model }));
                      }}>
                      {tagProviders.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                  </label>
                  <label className="blabel text-[10px]">
                    MODEL
                    <select className="binput mt-1 w-full px-2 py-1 text-xs" value={draftProvider?.models.includes(tagDraft.model) ? tagDraft.model : "__custom"}
                      onChange={(e) => setTagDraft((d) => ({ ...d, model: e.target.value === "__custom" ? "" : e.target.value }))}>
                      {(draftProvider?.models ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
                      <option value="__custom">Custom…</option>
                    </select>
                    {(!draftProvider || !draftProvider.models.includes(tagDraft.model)) && (
                      <input className="binput mt-1 w-full px-2 py-1 text-xs" placeholder="model id" value={tagDraft.model}
                        onChange={(e) => setTagDraft((d) => ({ ...d, model: e.target.value }))} />
                    )}
                  </label>
                  <label className="blabel text-[10px] sm:col-span-2">
                    API KEY ({draftProvider?.keyEnv ?? "PROVIDER_KEY"}) — {tagging?.config.api_key_present ? `stored ${tagging?.config.key_masked ?? ""} (${tagging?.config.key_source}); leave blank to keep` : "not set; paste to store encrypted"}
                    <input type="password" autoComplete="off" className="binput mt-1 w-full px-2 py-1 text-xs"
                      placeholder={tagging?.config.api_key_present ? "•••••••• (unchanged)" : "paste API key"}
                      value={tagDraft.api_key} onChange={(e) => setTagDraft((d) => ({ ...d, api_key: e.target.value }))} />
                  </label>
                  {!tagging?.config.master_key_present && (
                    <p className="blabel text-[9px] text-[#ff3b30] sm:col-span-2">
                      SOURCE_KEYS_SECRET IS NOT SET ON THE SERVER — ENCRYPTED KEY STORAGE IS UNAVAILABLE. SET IT, OR PROVIDE THE KEY VIA THE {draftProvider?.keyEnv} ENV VAR INSTEAD.
                    </p>
                  )}
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="bbtn bbtn-green px-4 py-1 text-xs" disabled={!!busy || (tagDraft.mode === "llm" && !tagDraft.model.trim())} onClick={saveTagConfig}>
                  {busy === "tagcfg" ? "Saving…" : "Save config"}
                </button>
                <button className="bbtn px-4 py-1 text-xs" disabled={!!busy} onClick={() => setTagCfgOpen(false)}>Cancel</button>
              </div>
            </div>
            </div>
          )}

          <p className="blabel mt-3 border-l-4 border-[#00a651] pl-2 text-[10px] text-black/70">
            EVERY JOB IS RULE-TAGGED (ROLE / CITY / TYPE / FRESHER) WHILE IT IS SCRAPED + STORED — NO LLM, NO TOKENS, NO WAIT. SWITCH TO PAID LLM ABOVE TO OVERRIDE WITH {tagMode === "llm" ? tagging?.config.provider?.toUpperCase() : "GROQ / OPENAI / CLAUDE"}.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button className="bbtn bbtn-green px-4 py-2 text-xs" disabled={!!busy}
              onClick={() => runAction("retag", "/api/admin/retag", {}, (j) =>
                `Rule-tagged ${j.tagged} post(s) in ${j.batches} batch(es) — zero LLM tokens spent`)}>
              {busy === "retag" ? "Rule-tagging…" : "Rule-tag all untagged (no LLM) →"}
            </button>
            <button className="bbtn px-4 py-2 text-xs" disabled={!!busy}
              title="Re-runs the (fixed) rules over rows already tagged rule-v1; LLM-tagged rows are untouched"
              onClick={() => runAction("reapply", "/api/admin/retag", { reapply: true }, (j) =>
                `Re-applied rules to ${j.tagged} post(s) in ${j.batches} batch(es) — accuracy refresh, zero tokens`)}>
              {busy === "reapply" ? "Re-applying…" : "Re-apply rules to rule-tagged →"}
            </button>
            <span className="blabel text-[9px] text-black/50">
              BACKFILLS EXISTING PENDING / FAILED / UNTAGGED ROWS WITH THE SAME DETERMINISTIC RULES USED AT INGEST.
            </span>
          </div>
          {tagMode === "llm" && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label className="blabel text-[10px]">Batches</label>
              <input type="number" min={1} max={50} className="binput w-20 px-2 py-1 text-xs" value={batches}
                onChange={(e) => setBatches(Number(e.target.value))} />
              <button className="bbtn bbtn-blue px-4 py-2 text-xs" disabled={!!busy || !tagging?.config.api_key_present}
                title={tagging?.config.api_key_present ? "" : "Add the provider API key in Configure first"}
                onClick={() => runAction("tag", "/api/admin/tag", { max_batches: batches }, (j) => {
                  if (j.status === "skipped_no_key") return "No API key — add it in Configure";
                  if (j.status === "skipped_daily_limit") return "Groq free daily limit reached — resume tomorrow";
                  const pace = j.status === "stopped_rate_window" || j.status === "stopped_daily_limit"
                    ? " // free-tier pace hit — click again to continue" : "";
                  return `LLM-tagged ${j.tagged} post(s) in ${j.batches} batch(es)${j.failed ? `, ${j.failed} failed` : ""}${j.city_mismatches ? `, ${j.city_mismatches} city mismatch(es)` : ""} (${j.provider ?? ""} ${j.model ?? ""})${pace}`;
                })}>
                {busy === "tag" ? "Tagging… (up to 50s)" : `Tag with ${tagging?.config.provider?.toUpperCase() ?? "LLM"} →`}
              </button>
              <button className="bbtn px-4 py-2 text-xs" disabled={!!busy || failed === 0}
                onClick={() => runAction("retry", "/api/admin/tag", { retry_failed: true, max_batches: batches }, (j) =>
                  `Reset ${j.reset_failed} failed post(s) to pending, tagged ${j.tagged}`)}>
                {busy === "retry" ? "Retrying…" : "Retry failed"}
              </button>
              <span className="blabel text-[9px] text-black/50">
                UPGRADES PENDING + RULE-TAGGED ROWS WITH THE CONFIGURED MODEL. ALREADY LLM-TAGGED ROWS ARE SKIPPED.
                {tagging?.config.provider === "groq" && " GROQ FREE TIER IS PACED (30 RPM / 8K TPM / 1K RPD / 200K TPD) — EXPECT ~2 BATCHES PER CLICK; 429s BACK OFF AUTOMATICALLY."}
              </span>
            </div>
          )}
          <div className="bcard mt-4 bg-black p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="blabel text-xs text-[#ffd400]">TAGGING LOG_</p>
              <div className="flex flex-wrap items-center gap-2">
                <button className="bchip cursor-pointer bg-white/10 text-white/70 hover:bg-white/25"
                  title="Clear the box; the next action streams fresh entries"
                  onClick={() => { setTagLogBaseline(new Set((tagging?.recent_runs ?? []).map((r) => r.id))); setTagEvents([]); }}>
                  Clear
                </button>
                <button className="bchip cursor-pointer bg-white/10 text-white/70 hover:bg-white/25"
                  title="Show the last 10 stored LLM runs again"
                  onClick={() => setTagLogBaseline(null)}>
                  History
                </button>
                <span className="blabel text-[9px] text-white/50">
                  {taggingBusy ? "STREAMING… THIS ACTION" : tagLogBaseline != null ? "THIS SESSION — FINAL RESULTS" : "IDLE — LAST 10 LLM RUNS"}
                </span>
              </div>
            </div>
            <div className="bscroll mt-2 max-h-64 space-y-0.5 overflow-auto border-2 border-white/20 bg-black p-2 font-mono text-[10px] leading-snug text-[#00a651]">
              {taggingBusy && (
                <p className="text-[#ffd400]">▶ {busy} … RUNNING since {hms(statusAt?.toISOString())}</p>
              )}
              {tagEvents.map((e) => (
                <p key={`event-${e.id}`} className={e.kind === "err" ? "text-[#ff3b30]" : ""}>
                  [{hms(e.at)}] {e.text}
                </p>
              ))}
              {shownTagRuns.map((r) => (
                <p key={`run-${r.id}`} className={r.error ? "text-[#ff3b30]" : r.ok ? "" : "text-white/70"}>
                  [{hms(r.ran_at)}] {r.model} // batch={r.batch_size} in={r.input_tokens} out={r.output_tokens}
                  {r.cached_input_tokens ? ` cache=${r.cached_input_tokens}` : ""}
                  {r.latency_ms ? ` ${r.latency_ms}ms` : ""} {r.ok ? "OK" : `FAILED ${r.error ?? ""}`}
                </p>
              ))}
              {!taggingBusy && tagEvents.length === 0 && shownTagRuns.length === 0 && (
                <p className="text-white/50">log clear — click Tag / Rule-tag; per-batch results and action summaries stream here.</p>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}