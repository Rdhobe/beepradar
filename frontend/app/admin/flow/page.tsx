import Link from "next/link";

const PIPELINE = [
  {
    n: "01",
    title: "COLLECT",
    body: "45 registered sources run one at a time on their own cron, quota and 6h cooldown. Real public APIs, ATS career boards and licensed feeds only.",
    color: "bg-white",
  },
  {
    n: "02",
    title: "FILTER",
    body: "India + fresher/intern heuristics reject senior roles, scams and non-India posts before anything reaches the database.",
    color: "bg-[#ffd400]",
  },
  {
    n: "03",
    title: "DEDUPE",
    body: "Three layers — exact URL, content fingerprint, then fuzzy title/company — collapse the same opening posted on five boards into one row.",
    color: "bg-white",
  },
  {
    n: "04",
    title: "TAG + SERVE",
    body: "Free rules tag at ingest; the optional Groq pass labels role and city. Search, filters and apply links are served from Postgres.",
    color: "bg-[#2400ff] text-white",
  },
];

const PAGES = [
  ["/", "Landing", "Public story, live counts and a 6-job preview. Shows the promise before asking anyone to sign in."],
  ["/login", "Sign in / Sign up", "Supabase email + password. Admin access is granted only when the email is in ADMIN_EMAILS."],
  ["/jobs", "Job board", "Search, role / city / type filters, pagination and the apply modal. Signed-in users get 20 per page; visitors see 6."],
  ["/admin", "Control room", "You drive ingestion here: run sources, connect keys, edit sources, configure tagging and watch the live run log."],
  ["/admin/stats", "Pipeline stats", "Funnel by source, duplicates dropped, LLM cost, quota usage and cooldown/backoff state."],
  ["/admin/flow", "This page", "The always-on map of the whole system — use it while recording, onboarding or debugging."],
];

const ADMIN_CONTROLS = [
  ["01 // Run ingestion", "Run due sources is the safe button. It triggers only connected sources that have quota left and are off the 6h cooldown. The ready queue shows exactly what can run now, and the sticky status bar keeps success/error visible while you scroll."],
  ["02 // Integrations", "Every keyed source appears with a connection state. Keys can come from Vercel env vars or be pasted once into the encrypted vault — the vault wins when both exist. Connect and Configure open in a modal, so the form appears where you are, not above the list."],
  ["03 // Keys vault", "AES-256-GCM encrypted with SOURCE_KEYS_SECRET. Never paste a real key into chat, a ticket or a screenshot. Masked values are safe to show."],
  ["04 // Advanced table", "Full source registry: adapter, cron, budgets, quotas and field mapping. Use Test fetch before enabling a custom HTTP source."],
  ["05 // Tagging", "Rules run free at ingest. Switch mode to LLM to use GROQ_API_KEY; the provider/model and spend are tracked in Stats. The tagging log streams action summaries and per-batch LLM results, with Clear and History controls."],
];

const RULES = [
  ["REAL DATA ONLY", "No seed or synthetic jobs in production. Every row links back to a real posting."],
  ["BLOCKLIST", "LinkedIn, Naukri, Indeed, Internshala, Glassdoor and Foundit are never fetched directly. Licensed feeds contribute link-back-only records marked licensedFeed."],
  ["QUOTA FIRST", "Per-source windows (minute/hour/day/month) are checked before every request, with a 0.8 safety margin (0.9 for official limits)."],
  ["429 POLICY", "Honor Retry-After. Three consecutive 429s trigger exponential backoff and halve that source's daily budget until a clean run."],
  ["FRESHNESS", "Posts not seen again for 14 days are retired, so the board reflects currently live openings."],
  ["VERCEL", "There is no Vercel cron in this deployment. Run ingestion from the Control room, then review Stats."],
];

const ENV_GROUPS = [
  ["Core", "DATABASE_URL · NEXT_PUBLIC_SUPABASE_URL · NEXT_PUBLIC_SUPABASE_ANON_KEY · ADMIN_EMAILS · SOURCE_KEYS_SECRET"],
  ["Working feeds", "CAREERJET_API_KEY · RAPIDAPI_KEY · HIMALAYAS_API_KEY · SERPAPI_KEY · JOBSPIPE_API_KEY · APIFY_TOKEN"],
  ["Tagging", "GROQ_API_KEY (default model openai/gpt-oss-20b) — no Anthropic key needed"],
  ["Optional feeds", "CLEANJOBDATA_API_KEY · FANTASTIC_JOBS_API_KEY — add these to enable the two newest trial sources"],
  ["Politeness", "USER_AGENT — replace YOUR-DOMAIN and YOUR-EMAIL with your real Vercel URL and contact before going live"],
];

export default function FlowPage() {
  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="bchip inline-block -rotate-1 bg-black text-[#ffd400]">FLOW_</span>
          <h1 className="mt-3 text-3xl font-black uppercase leading-none tracking-tight">
            How BeepRadar works<span className="text-[#2400ff]">_</span>
          </h1>
          <p className="blabel mt-2 text-[10px] text-black/60">
            THE WHOLE SYSTEM ON ONE PAGE // PIPELINE → PAGES → ADMIN → DEPLOY
          </p>
        </div>
        <div className="flex gap-3">
          <Link href="/admin" className="bbtn px-3 py-1.5 text-xs">← Control room</Link>
          <Link href="/admin/stats" className="bbtn px-3 py-1.5 text-xs">Stats →</Link>
        </div>
      </div>

      <section className="bcard bg-[#2400ff] p-6 text-white">
        <p className="blabel text-[11px] text-[#ffd400]">30-SECOND VERSION_</p>
        <p className="mt-3 max-w-3xl text-lg font-black uppercase leading-snug">
          Sources are polled politely → bad posts are rejected → duplicates collapse →
          roles and cities are tagged → the board serves fast search. You control every
          run from the Control room, and Stats proves what happened.
        </p>
      </section>

      <section>
        <h2 className="blabel mb-4 border-l-4 border-black pl-3 text-sm">01 // The ingestion pipeline</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PIPELINE.map((s) => (
            <div key={s.n} className={`bcard p-5 ${s.color}`}>
              <p className="blabel text-xs opacity-60">{s.n}</p>
              <h3 className="mt-2 text-lg font-black uppercase">{s.title}</h3>
              <p className="mt-2 font-mono text-[11px] leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="blabel mb-4 border-l-4 border-black pl-3 text-sm">02 // Page map</h2>
        <div className="overflow-x-auto pb-2 pr-2">
          <table className="btable min-w-full">
            <thead>
              <tr><th>Route</th><th>Page</th><th>What it does</th></tr>
            </thead>
            <tbody>
              {PAGES.map(([route, name, desc]) => (
                <tr key={route}>
                  <td className="font-mono text-xs font-bold">{route}</td>
                  <td className="font-bold">{name}</td>
                  <td>{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="blabel mb-4 border-l-4 border-black pl-3 text-sm">03 // Control room, block by block</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {ADMIN_CONTROLS.map(([title, body]) => (
            <div key={title} className="bcard p-5">
              <h3 className="blabel text-xs font-bold uppercase">{title}</h3>
              <p className="mt-2 font-mono text-[11px] leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="blabel mb-4 border-l-4 border-black pl-3 text-sm">04 // Non-negotiable rules</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {RULES.map(([title, body]) => (
            <div key={title} className="bcard border-3 border-black p-4">
              <p className="blabel text-[10px] text-[#2400ff]">{title}</p>
              <p className="mt-2 font-mono text-[11px] leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="blabel mb-4 border-l-4 border-black pl-3 text-sm">05 // Deployment checklist</h2>
        <div className="space-y-3">
          {ENV_GROUPS.map(([title, body]) => (
            <div key={title} className="bcard p-4">
              <p className="blabel text-[10px] text-[#2400ff]">{title.toUpperCase()}</p>
              <p className="mt-1 break-words font-mono text-[11px] leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
        <p className="blabel mt-4 text-[10px] text-black/60">
          SET THESE IN VERCEL → PROJECT SETTINGS → ENVIRONMENT VARIABLES, THEN REDEPLOY. NEVER COMMIT A REAL KEY.
        </p>
      </section>

      <div className="bcard bg-[#ffd400] p-5">
        <p className="blabel text-[10px]">RECORDING TIP_</p>
        <p className="mt-1 font-mono text-[11px] leading-relaxed">
          Keep this tab open while recording. Start at 01, jump to the live page named in 02,
          then return here to close on 04 + 05. That gives the video a clean beginning, middle and end.
        </p>
      </div>
    </div>
  );
}
