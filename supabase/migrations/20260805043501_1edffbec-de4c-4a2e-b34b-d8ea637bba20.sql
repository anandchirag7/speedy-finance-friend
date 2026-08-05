CREATE TABLE public.data_reset_audit (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL,
  kind TEXT NOT NULL DEFAULT 'household',
  scopes TEXT[] NOT NULL DEFAULT '{}',
  account_id UUID,
  account_name TEXT,
  deleted JSONB NOT NULL DEFAULT '[]'::jsonb,
  counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'success',
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE
);

GRANT SELECT, INSERT, UPDATE ON public.data_reset_audit TO authenticated;
GRANT ALL ON public.data_reset_audit TO service_role;

ALTER TABLE public.data_reset_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Household members can view reset history"
ON public.data_reset_audit FOR SELECT TO authenticated
USING (public.has_household_access(household_id));

CREATE POLICY "Household members can log resets"
ON public.data_reset_audit FOR INSERT TO authenticated
WITH CHECK (public.has_household_access(household_id) AND actor_id = auth.uid());

CREATE POLICY "Actors can update their own reset log"
ON public.data_reset_audit FOR UPDATE TO authenticated
USING (actor_id = auth.uid())
WITH CHECK (actor_id = auth.uid());

CREATE INDEX idx_data_reset_audit_household ON public.data_reset_audit(household_id, created_at DESC);