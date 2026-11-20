-- BeepRadar: move PUBLIC reads onto stateless PostgREST (HTTPS), off the
-- transaction pooler. The board/stats/runlog routes already branch on
-- restEnabled(); this grants the anon role the SELECT it needs so that probe
-- succeeds. Public traffic then never competes with manual ingest writes for a
-- pooled backend, which is what was saturating the pool and 503-ing bulk runs.
--
-- Run once in the Supabase SQL Editor, then RESTART the dev server: the REST
-- probe in lib/db/rest.ts caches its result at module load.
-- Re-runnable (idempotent).

-- 1) SELECT for anon on the five publicly-read tables ONLY.
GRANT SELECT ON public.jobs               TO anon;
GRANT SELECT ON public.ingest_runs        TO anon;
GRANT SELECT ON public.llm_runs           TO anon;
GRANT SELECT ON public.source_quota_usage TO anon;
GRANT SELECT ON public.source_state       TO anon;

-- 2) RLS + permissive read policy. The wire role (postgres) OWNS these tables
--    and bypasses RLS, so admin ingest writes/updates are unaffected.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['jobs','ingest_runs','llm_runs','source_quota_usage','source_state']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS public_read ON public.%I', t);
    EXECUTE format('CREATE POLICY public_read ON public.%I FOR SELECT TO anon USING (true)', t);
  END LOOP;
END $$;

-- 3) Keep admin config + encrypted keys OFF REST. source_admin.patch/custom can
--    embed API tokens and integration_secrets holds ciphertext; loadRegistry and
--    lib/secrets.ts read these over the authenticated wire only. Revoke any
--    default anon/authenticated grant and enable RLS with NO policy (deny by
--    default). The postgres owner still bypasses RLS for the admin panel.
REVOKE ALL ON public.source_admin        FROM anon, authenticated;
REVOKE ALL ON public.integration_secrets FROM anon, authenticated;
REVOKE ALL ON public.job_sources_seen    FROM anon, authenticated;
REVOKE ALL ON public.http_cache          FROM anon, authenticated;
ALTER TABLE public.source_admin        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_sources_seen    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.http_cache          ENABLE ROW LEVEL SECURITY;