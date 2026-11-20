import type { Metadata } from "next";
import Link from "next/link";
import AuthNav from "@/components/AuthNav";
import "./globals.css";

export const metadata: Metadata = {
  title: "BEEPRADAR — India fresher & intern jobs",
  description:
    "Real fresher and internship openings in India, aggregated from public APIs and company career boards, deduplicated and AI-tagged by role and city.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b-4 border-black bg-[#ffd400]">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 xl:max-w-6xl 2xl:max-w-7xl">
            <Link href="/" className="flex items-center" aria-label="BeepRadar home">
              <img src="/images/logo-trim.png" alt="BeepRadar — find, apply, grow" className="h-10 w-auto" />
            </Link>
            <nav className="blabel flex items-center gap-4 text-xs text-black">
              <Link href="/jobs" className="border-b-3 border-transparent hover:border-black">Jobs</Link>
              <AuthNav />
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8 xl:max-w-6xl 2xl:max-w-7xl">{children}</main>
        <footer className="border-t-4 border-black bg-black text-white">
          <div className="mx-auto max-w-5xl px-4 py-10 xl:max-w-6xl 2xl:max-w-7xl">
            <div className="grid gap-10 md:grid-cols-[1.5fr_1fr_1fr]">
              <div>
                <div className="inline-block border-3 border-black bg-[#ffd400] px-3 py-2 shadow-[6px_6px_0_#2400ff]">
                  <img src="/images/logo-trim.png" alt="BeepRadar — find, apply, grow" className="h-12 w-auto" />
                </div>
                <p className="blabel mt-5 max-w-xs text-[11px] leading-relaxed text-white/70">
                  India&apos;s fresher &amp; intern openings on one radar. Real posts, deduplicated, tagged by role and city.
                </p>
              </div>
              <nav aria-label="Footer">
                <p className="blabel text-[11px] text-[#ffd400]">Explore_</p>
                <ul className="mt-4 space-y-3 text-sm font-black uppercase tracking-tight">
                  <li><Link href="/jobs" className="border-b-2 border-transparent hover:border-[#ffd400] hover:text-[#ffd400]">The job board</Link></li>
                  <li><Link href="/login" className="border-b-2 border-transparent hover:border-[#ffd400] hover:text-[#ffd400]">Sign in</Link></li>
                  <li><Link href="/" className="border-b-2 border-transparent hover:border-[#ffd400] hover:text-[#ffd400]">Home</Link></li>
                </ul>
              </nav>
              <div>
                <p className="blabel text-[11px] text-[#ffd400]">The promise_</p>
                <ul className="mt-4 space-y-3 text-[12px] font-black uppercase tracking-wide">
                  <li className="flex items-center gap-2"><span className="h-3 w-3 border-2 border-black bg-[#00a651]" />Real posts only</li>
                  <li className="flex items-center gap-2"><span className="h-3 w-3 border-2 border-black bg-[#ffd400]" />Deduplicated</li>
                  <li className="flex items-center gap-2"><span className="h-3 w-3 border-2 border-black bg-[#ff3b30]" />AI-tagged role + city</li>
                </ul>
              </div>
            </div>
            <div className="mt-10 flex flex-col gap-2 border-t-3 border-white/20 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="blabel text-[10px] text-white/60">© 2026 BeepRadar // built for the Beep hiring assignment</p>
              <p className="blabel text-[10px] text-[#ffd400]">Find • Apply • Grow</p>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}