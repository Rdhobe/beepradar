"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { getSupabase, supabaseConfigured } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const configured = supabaseConfigured();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const supabase = getSupabase();
    if (!supabase) return;
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push("/jobs");
        router.refresh();
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session) {
          router.push("/jobs");
          router.refresh();
        } else {
          setNotice("Account created. Check your email for a confirmation link, then sign in.");
          setMode("signin");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md py-10">
      <span className="bchip inline-block -rotate-1 bg-[#2400ff] text-white">ACCESS_</span>
      <h1 className="mt-3 text-3xl font-black uppercase leading-none tracking-tight">
        {mode === "signin" ? "Welcome back_" : "Join the radar_"}
      </h1>
      <p className="blabel mt-3 border-l-4 border-black pl-3 text-xs text-black/70">
        {mode === "signin"
          ? "SIGN IN TO KEEP YOUR JOB SEARCH IN ONE PLACE"
          : "ONE ACCOUNT FOR YOUR BEEPRADAR JOB SEARCH"}
      </p>

      {!configured ? (
        <div className="bcard mt-8 bg-[#ffd400] px-4 py-3 text-sm font-medium">
          <span className="blabel block text-xs">!! LOGIN NOT CONFIGURED</span>
          <span className="mt-1 block">
            Set <code className="bg-black px-1 text-[#ffd400]">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code className="bg-black px-1 text-[#ffd400]">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, and enable Email auth in the Supabase dashboard.
            You can still <Link href="/jobs" className="font-bold underline underline-offset-2">browse jobs</Link> without an account.
          </span>
        </div>
      ) : (
        <form onSubmit={submit} className="bcard mt-8 space-y-5 p-6">
          <div>
            <label htmlFor="email" className="blabel block text-xs">Email</label>
            <input
              id="email" type="email" required autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)}
              className="binput mt-2 w-full px-3 py-2.5 text-sm"
              placeholder="you@college.edu"
            />
          </div>
          <div>
            <label htmlFor="password" className="blabel block text-xs">Password</label>
            <input
              id="password" type="password" required minLength={6}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password} onChange={(e) => setPassword(e.target.value)}
              className="binput mt-2 w-full px-3 py-2.5 text-sm"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="border-3 border-black bg-[#ff3b30] px-3 py-2 text-sm font-bold text-white shadow-[4px_4px_0_#000]">!! {error}</p>
          )}
          {notice && (
            <p className="border-3 border-black bg-[#00a651] px-3 py-2 text-sm font-bold text-white shadow-[4px_4px_0_#000]">{notice}</p>
          )}

          <button
            type="submit" disabled={busy}
            className="bbtn bbtn-yellow w-full px-4 py-2.5 text-sm">
            {busy ? "Please wait…" : mode === "signin" ? "Sign in →" : "Create account →"}
          </button>

          <p className="blabel text-center text-xs">
            {mode === "signin" ? "NEW TO BEEPRADAR?" : "ALREADY HAVE AN ACCOUNT?"}{" "}
            <button
              type="button"
              className="font-bold text-[#2400ff] underline underline-offset-2"
              onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); setNotice(null); }}>
              {mode === "signin" ? "CREATE AN ACCOUNT" : "SIGN IN"}
            </button>
          </p>
        </form>
      )}

      <p className="blabel mt-6 text-center text-xs text-black/60">
        JUST LOOKING? <Link href="/jobs" className="font-bold text-[#2400ff] underline underline-offset-2">BROWSE JOBS WITHOUT SIGNING IN</Link>
      </p>
    </div>
  );
}