"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";

export default function AuthNav() {
  const [email, setEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    const probe = async (token: string | undefined) => {
      if (!token) { setIsAdmin(false); return; }
      try {
        const resp = await fetch("/api/admin/me", {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10000),
        });
        setIsAdmin(resp.ok);
      } catch {
        setIsAdmin(false);
      }
    };
    supabase.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user.email ?? null);
      probe(data.session?.access_token);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user.email ?? null);
      probe(session?.access_token);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!email) {
    return (
      <Link href="/login" className="bbtn bbtn-ink px-3 py-1.5 text-xs">
        Sign in
      </Link>
    );
  }
  return (
    <span className="flex items-center gap-3">
      {isAdmin && (
        <Link href="/admin" className="border-b-3 border-transparent hover:border-black">Dashboard</Link>
      )}
      <span className="hidden max-w-40 truncate text-[10px] normal-case tracking-normal text-black sm:inline" title={email}>
        {email}
      </span>
      <button
        className="bbtn px-3 py-1.5 text-xs"
        onClick={async () => { await getSupabase()?.auth.signOut(); }}>
        Sign out
      </button>
    </span>
  );
}