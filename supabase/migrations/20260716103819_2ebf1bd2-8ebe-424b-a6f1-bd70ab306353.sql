
-- 1) Extend transactions with rich fields
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS merchant text,
  ADD COLUMN IF NOT EXISTS memo text,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS check_number text,
  ADD COLUMN IF NOT EXISTS cleared_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS is_flagged boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_favorite boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_reviewed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_read boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS tax_code text,
  ADD COLUMN IF NOT EXISTS budget_id uuid,
  ADD COLUMN IF NOT EXISTS attachment_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comment_count int NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'txn_cleared_status_check') THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT txn_cleared_status_check
      CHECK (cleared_status IN ('pending','cleared','reconciled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_txn_household_date ON public.transactions (household_id, txn_date DESC);
CREATE INDEX IF NOT EXISTS idx_txn_merchant ON public.transactions (household_id, merchant);

-- 2) Attachments
CREATE TABLE IF NOT EXISTS public.transaction_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transaction_attachments TO authenticated;
GRANT ALL ON public.transaction_attachments TO service_role;
ALTER TABLE public.transaction_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "attachments household access" ON public.transaction_attachments;
CREATE POLICY "attachments household access" ON public.transaction_attachments
  FOR ALL USING (public.has_household_access(household_id))
  WITH CHECK (public.has_household_access(household_id));
CREATE INDEX IF NOT EXISTS idx_attach_txn ON public.transaction_attachments(transaction_id);

-- 3) Comments
CREATE TABLE IF NOT EXISTS public.transaction_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transaction_comments TO authenticated;
GRANT ALL ON public.transaction_comments TO service_role;
ALTER TABLE public.transaction_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "comments household access" ON public.transaction_comments;
CREATE POLICY "comments household access" ON public.transaction_comments
  FOR ALL USING (public.has_household_access(household_id))
  WITH CHECK (public.has_household_access(household_id));
CREATE INDEX IF NOT EXISTS idx_comments_txn ON public.transaction_comments(transaction_id);

-- 4) Activity log
CREATE TABLE IF NOT EXISTS public.transaction_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  actor_id uuid,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.transaction_activity TO authenticated;
GRANT ALL ON public.transaction_activity TO service_role;
ALTER TABLE public.transaction_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "activity household read" ON public.transaction_activity;
CREATE POLICY "activity household read" ON public.transaction_activity
  FOR SELECT USING (public.has_household_access(household_id));
DROP POLICY IF EXISTS "activity household insert" ON public.transaction_activity;
CREATE POLICY "activity household insert" ON public.transaction_activity
  FOR INSERT WITH CHECK (public.has_household_access(household_id));
CREATE INDEX IF NOT EXISTS idx_activity_txn ON public.transaction_activity(transaction_id, created_at DESC);

-- 5) Saved views
CREATE TABLE IF NOT EXISTS public.transaction_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  user_id uuid NOT NULL,
  name text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  layout jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transaction_views TO authenticated;
GRANT ALL ON public.transaction_views TO service_role;
ALTER TABLE public.transaction_views ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "views own" ON public.transaction_views;
CREATE POLICY "views own" ON public.transaction_views
  FOR ALL USING (user_id = auth.uid() AND public.has_household_access(household_id))
  WITH CHECK (user_id = auth.uid() AND public.has_household_access(household_id));
CREATE TRIGGER trg_views_updated_at
  BEFORE UPDATE ON public.transaction_views
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
