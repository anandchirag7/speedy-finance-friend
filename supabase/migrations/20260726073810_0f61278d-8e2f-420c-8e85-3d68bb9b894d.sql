
CREATE TABLE public.payee_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  payee_id UUID NOT NULL REFERENCES public.memorized_payees(id) ON DELETE CASCADE,
  txn_type TEXT NOT NULL CHECK (txn_type IN ('expense','income','transfer','deposit','withdrawal','investment')),
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  transfer_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  memo TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  default_amount NUMERIC,
  min_amount NUMERIC,
  max_amount NUMERIC,
  priority INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX payee_rules_payee_idx ON public.payee_rules(payee_id);
CREATE INDEX payee_rules_household_idx ON public.payee_rules(household_id);
CREATE UNIQUE INDEX payee_rules_unique_type_priority
  ON public.payee_rules(payee_id, txn_type, priority)
  WHERE is_active = true;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payee_rules TO authenticated;
GRANT ALL ON public.payee_rules TO service_role;

ALTER TABLE public.payee_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Household members can manage payee rules"
  ON public.payee_rules
  FOR ALL
  USING (public.has_household_access(household_id))
  WITH CHECK (public.has_household_access(household_id));

CREATE TRIGGER payee_rules_set_updated_at
  BEFORE UPDATE ON public.payee_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
