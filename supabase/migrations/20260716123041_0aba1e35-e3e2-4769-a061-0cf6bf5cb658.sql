
CREATE TABLE public.memorized_payees (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  merchant TEXT NOT NULL,
  merchant_type TEXT,
  website TEXT,
  address TEXT,
  notes TEXT,
  txn_type TEXT NOT NULL DEFAULT 'expense' CHECK (txn_type IN ('expense','income','transfer','deposit','withdrawal','investment')),
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  memo TEXT,
  default_amount NUMERIC(14,2),
  amount_tolerance_pct NUMERIC(5,2),
  currency TEXT NOT NULL DEFAULT 'INR',
  payment_method TEXT,
  account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  transfer_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  splits JSONB NOT NULL DEFAULT '[]'::jsonb,
  auto_categorize BOOLEAN NOT NULL DEFAULT true,
  auto_memo BOOLEAN NOT NULL DEFAULT false,
  auto_tags BOOLEAN NOT NULL DEFAULT false,
  auto_amount BOOLEAN NOT NULL DEFAULT false,
  auto_clear BOOLEAN NOT NULL DEFAULT false,
  auto_attach_receipt BOOLEAN NOT NULL DEFAULT false,
  auto_budget BOOLEAN NOT NULL DEFAULT false,
  auto_reviewed BOOLEAN NOT NULL DEFAULT false,
  auto_tax BOOLEAN NOT NULL DEFAULT false,
  auto_business BOOLEAN NOT NULL DEFAULT false,
  priority INTEGER NOT NULL DEFAULT 0,
  locked BOOLEAN NOT NULL DEFAULT false,
  never_auto BOOLEAN NOT NULL DEFAULT false,
  ai_suggestions BOOLEAN NOT NULL DEFAULT true,
  fuzzy_match BOOLEAN NOT NULL DEFAULT true,
  exact_match_only BOOLEAN NOT NULL DEFAULT false,
  min_amount NUMERIC(14,2),
  max_amount NUMERIC(14,2),
  restrict_account_ids UUID[] NOT NULL DEFAULT '{}',
  date_range_start DATE,
  date_range_end DATE,
  apply_to_downloaded BOOLEAN NOT NULL DEFAULT true,
  apply_to_manual BOOLEAN NOT NULL DEFAULT true,
  apply_to_import BOOLEAN NOT NULL DEFAULT true,
  is_recurring BOOLEAN NOT NULL DEFAULT false,
  recurrence_freq TEXT CHECK (recurrence_freq IN ('weekly','monthly','quarterly','yearly','custom')),
  recurrence_day INTEGER,
  next_expected_date DATE,
  reminder_days INTEGER,
  budget_link UUID,
  show_in_calendar BOOLEAN NOT NULL DEFAULT false,
  is_favorite BOOLEAN NOT NULL DEFAULT false,
  is_disabled BOOLEAN NOT NULL DEFAULT false,
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_by UUID,
  modified_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_memorized_payees_household ON public.memorized_payees(household_id);
CREATE INDEX idx_memorized_payees_merchant ON public.memorized_payees(household_id, lower(merchant));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.memorized_payees TO authenticated;
GRANT ALL ON public.memorized_payees TO service_role;

ALTER TABLE public.memorized_payees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Household members can view memorized payees"
  ON public.memorized_payees FOR SELECT TO authenticated
  USING (public.has_household_access(household_id));
CREATE POLICY "Household members can insert memorized payees"
  ON public.memorized_payees FOR INSERT TO authenticated
  WITH CHECK (public.has_household_access(household_id));
CREATE POLICY "Household members can update memorized payees"
  ON public.memorized_payees FOR UPDATE TO authenticated
  USING (public.has_household_access(household_id))
  WITH CHECK (public.has_household_access(household_id));
CREATE POLICY "Household members can delete memorized payees"
  ON public.memorized_payees FOR DELETE TO authenticated
  USING (public.has_household_access(household_id));

CREATE TRIGGER set_memorized_payees_updated_at
  BEFORE UPDATE ON public.memorized_payees
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
