ALTER TABLE public.statement_uploads
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS size_bytes bigint,
  ADD COLUMN IF NOT EXISTS import_token uuid,
  ADD COLUMN IF NOT EXISTS imported_at timestamptz,
  ADD COLUMN IF NOT EXISTS inserted_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS archive_expires_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS statement_uploads_import_token_key
  ON public.statement_uploads(import_token) WHERE import_token IS NOT NULL;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS import_batch_id uuid;

CREATE INDEX IF NOT EXISTS transactions_import_batch_idx
  ON public.transactions(import_batch_id) WHERE import_batch_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.statement_archive_settings (
  household_id uuid PRIMARY KEY REFERENCES public.households(id) ON DELETE CASCADE,
  archive_enabled boolean NOT NULL DEFAULT false,
  retention_days integer NOT NULL DEFAULT 90,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.statement_archive_settings TO authenticated;
GRANT ALL ON public.statement_archive_settings TO service_role;

ALTER TABLE public.statement_archive_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Household members manage archive settings"
  ON public.statement_archive_settings FOR ALL TO authenticated
  USING (public.has_household_access(household_id))
  WITH CHECK (public.has_household_access(household_id));

CREATE TRIGGER statement_archive_settings_set_updated_at
  BEFORE UPDATE ON public.statement_archive_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "Members read own household statements"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'statements' AND public.has_household_access(((storage.foldername(name))[1])::uuid));

CREATE POLICY "Members upload own household statements"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'statements' AND public.has_household_access(((storage.foldername(name))[1])::uuid));

CREATE POLICY "Members delete own household statements"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'statements' AND public.has_household_access(((storage.foldername(name))[1])::uuid));