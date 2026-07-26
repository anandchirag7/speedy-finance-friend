-- Presets: user-scoped, syncs across devices
CREATE TABLE public.report_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  config JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_presets TO authenticated;
GRANT ALL ON public.report_presets TO service_role;
ALTER TABLE public.report_presets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own report presets"
  ON public.report_presets FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE INDEX report_presets_user_idx ON public.report_presets(user_id, created_at DESC);
CREATE TRIGGER trg_report_presets_updated
  BEFORE UPDATE ON public.report_presets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Export jobs: track progress + result URLs
CREATE TABLE public.report_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued', -- queued | running | done | failed
  format TEXT NOT NULL, -- 'csv' | 'pdf'
  progress INTEGER NOT NULL DEFAULT 0, -- 0..100
  progress_message TEXT,
  report_ids TEXT[] NOT NULL DEFAULT '{}',
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  files JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{report_id, name, storage_path, size}]
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_jobs TO authenticated;
GRANT ALL ON public.report_jobs TO service_role;
ALTER TABLE public.report_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own report jobs"
  ON public.report_jobs FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Users insert own report jobs"
  ON public.report_jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own report jobs"
  ON public.report_jobs FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE INDEX report_jobs_user_idx ON public.report_jobs(user_id, created_at DESC);
CREATE TRIGGER trg_report_jobs_updated
  BEFORE UPDATE ON public.report_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();