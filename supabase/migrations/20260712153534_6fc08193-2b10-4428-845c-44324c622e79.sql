
-- =========================================
-- ENUMS
-- =========================================
CREATE TYPE public.app_role AS ENUM ('admin', 'member');

CREATE TYPE public.account_category AS ENUM (
  'bank', 'cash', 'credit_card', 'fixed_deposit', 'recurring_deposit',
  'ppf', 'epf', 'nps', 'mutual_fund', 'stocks',
  'post_office', 'gold', 'real_estate', 'loan', 'insurance',
  'chit_fund', 'other'
);

CREATE TYPE public.txn_type AS ENUM ('income', 'expense', 'transfer');

-- =========================================
-- HOUSEHOLDS + MEMBERSHIP
-- =========================================
CREATE TABLE public.households (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'My Household',
  base_currency TEXT NOT NULL DEFAULT 'INR',
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.households TO authenticated;
GRANT ALL ON public.households TO service_role;

CREATE TABLE public.household_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role public.app_role NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(household_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.household_members TO authenticated;
GRANT ALL ON public.household_members TO service_role;
CREATE INDEX household_members_user_idx ON public.household_members(user_id);

-- Security-definer helper - avoids recursive RLS
CREATE OR REPLACE FUNCTION public.has_household_access(_household_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.household_members
    WHERE household_id = _household_id AND user_id = auth.uid()
  );
$$;

ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read household" ON public.households
  FOR SELECT TO authenticated USING (public.has_household_access(id));
CREATE POLICY "members update household" ON public.households
  FOR UPDATE TO authenticated USING (public.has_household_access(id));
CREATE POLICY "create household" ON public.households
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own memberships" ON public.household_members
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_household_access(household_id));
CREATE POLICY "self join" ON public.household_members
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- =========================================
-- PROFILES
-- =========================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  default_household_id UUID REFERENCES public.households(id),
  number_format TEXT NOT NULL DEFAULT 'indian', -- 'indian' | 'international'
  use_lakh_crore BOOLEAN NOT NULL DEFAULT true,
  dark_mode BOOLEAN NOT NULL DEFAULT false,
  app_lock_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile all" ON public.profiles
  FOR ALL TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- =========================================
-- USER ROLES (future joint accounts)
-- =========================================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  role public.app_role NOT NULL,
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- =========================================
-- CATEGORIES
-- =========================================
CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'expense', -- 'income' | 'expense'
  icon TEXT,
  color TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT ALL ON public.categories TO service_role;
CREATE INDEX categories_household_idx ON public.categories(household_id);
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "household categories" ON public.categories
  FOR ALL TO authenticated
  USING (public.has_household_access(household_id))
  WITH CHECK (public.has_household_access(household_id));

-- =========================================
-- ACCOUNTS
-- =========================================
CREATE TABLE public.accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  institution TEXT,
  category public.account_category NOT NULL,
  subtype TEXT, -- e.g. savings / current / nre / nro / home_loan / term_life etc.
  currency TEXT NOT NULL DEFAULT 'INR',
  opening_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
  current_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
  is_liability BOOLEAN NOT NULL DEFAULT false,
  excluded_from_net_worth BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  account_number_last4 TEXT,
  notes TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb, -- type-specific fields
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounts TO authenticated;
GRANT ALL ON public.accounts TO service_role;
CREATE INDEX accounts_household_idx ON public.accounts(household_id);
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "household accounts" ON public.accounts
  FOR ALL TO authenticated
  USING (public.has_household_access(household_id))
  WITH CHECK (public.has_household_access(household_id));

-- =========================================
-- TRANSACTIONS
-- =========================================
CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  transfer_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  type public.txn_type NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  txn_date DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  split_parent_id UUID REFERENCES public.transactions(id) ON DELETE CASCADE,
  is_recurring_instance BOOLEAN NOT NULL DEFAULT false,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions TO authenticated;
GRANT ALL ON public.transactions TO service_role;
CREATE INDEX txn_household_date_idx ON public.transactions(household_id, txn_date DESC);
CREATE INDEX txn_account_idx ON public.transactions(account_id);
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "household txns" ON public.transactions
  FOR ALL TO authenticated
  USING (public.has_household_access(household_id))
  WITH CHECK (public.has_household_access(household_id));

-- =========================================
-- PHASE 2+ SCAFFOLD TABLES
-- =========================================
CREATE TABLE public.budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  period TEXT NOT NULL DEFAULT 'monthly',
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE,
  rollover BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.budgets TO authenticated;
GRANT ALL ON public.budgets TO service_role;
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "household budgets" ON public.budgets FOR ALL TO authenticated
  USING (public.has_household_access(household_id)) WITH CHECK (public.has_household_access(household_id));

CREATE TABLE public.budget_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id UUID NOT NULL REFERENCES public.budgets(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  amount NUMERIC(18,2) NOT NULL DEFAULT 0
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.budget_categories TO authenticated;
GRANT ALL ON public.budget_categories TO service_role;
ALTER TABLE public.budget_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "budget category access" ON public.budget_categories FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.budgets b WHERE b.id = budget_id AND public.has_household_access(b.household_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.budgets b WHERE b.id = budget_id AND public.has_household_access(b.household_id)));

CREATE TABLE public.bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  amount NUMERIC(18,2),
  due_date DATE NOT NULL,
  recurrence TEXT NOT NULL DEFAULT 'monthly',
  status TEXT NOT NULL DEFAULT 'upcoming',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bills TO authenticated;
GRANT ALL ON public.bills TO service_role;
ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "household bills" ON public.bills FOR ALL TO authenticated
  USING (public.has_household_access(household_id)) WITH CHECK (public.has_household_access(household_id));

CREATE TABLE public.goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target_amount NUMERIC(18,2) NOT NULL,
  target_date DATE,
  expected_return_pct NUMERIC(6,2) DEFAULT 8.0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.goals TO authenticated;
GRANT ALL ON public.goals TO service_role;
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "household goals" ON public.goals FOR ALL TO authenticated
  USING (public.has_household_access(household_id)) WITH CHECK (public.has_household_access(household_id));

CREATE TABLE public.goal_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  UNIQUE(goal_id, account_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.goal_accounts TO authenticated;
GRANT ALL ON public.goal_accounts TO service_role;
ALTER TABLE public.goal_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "goal accounts access" ON public.goal_accounts FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.goals g WHERE g.id = goal_id AND public.has_household_access(g.household_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.goals g WHERE g.id = goal_id AND public.has_household_access(g.household_id)));

CREATE TABLE public.holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  name TEXT,
  quantity NUMERIC(18,4) NOT NULL DEFAULT 0,
  avg_price NUMERIC(18,4) NOT NULL DEFAULT 0,
  current_price NUMERIC(18,4) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.holdings TO authenticated;
GRANT ALL ON public.holdings TO service_role;
ALTER TABLE public.holdings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "holdings access" ON public.holdings FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = account_id AND public.has_household_access(a.household_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = account_id AND public.has_household_access(a.household_id)));

CREATE TABLE public.holding_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  holding_id UUID NOT NULL REFERENCES public.holdings(id) ON DELETE CASCADE,
  txn_date DATE NOT NULL,
  quantity NUMERIC(18,4) NOT NULL,
  price NUMERIC(18,4) NOT NULL,
  kind TEXT NOT NULL DEFAULT 'buy',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.holding_transactions TO authenticated;
GRANT ALL ON public.holding_transactions TO service_role;
ALTER TABLE public.holding_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "holding txn access" ON public.holding_transactions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.holdings h JOIN public.accounts a ON a.id=h.account_id WHERE h.id = holding_id AND public.has_household_access(a.household_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.holdings h JOIN public.accounts a ON a.id=h.account_id WHERE h.id = holding_id AND public.has_household_access(a.household_id)));

CREATE TABLE public.price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  price_date DATE NOT NULL,
  price NUMERIC(18,4) NOT NULL,
  UNIQUE(symbol, price_date)
);
GRANT SELECT ON public.price_history TO authenticated;
GRANT ALL ON public.price_history TO service_role;
ALTER TABLE public.price_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "price history read" ON public.price_history FOR SELECT TO authenticated USING (true);

CREATE TABLE public.net_worth_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  total_assets NUMERIC(18,2) NOT NULL,
  total_liabilities NUMERIC(18,2) NOT NULL,
  net_worth NUMERIC(18,2) NOT NULL,
  breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(household_id, snapshot_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.net_worth_snapshots TO authenticated;
GRANT ALL ON public.net_worth_snapshots TO service_role;
ALTER TABLE public.net_worth_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "household snapshots" ON public.net_worth_snapshots FOR ALL TO authenticated
  USING (public.has_household_access(household_id)) WITH CHECK (public.has_household_access(household_id));

CREATE TABLE public.import_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  match_field TEXT NOT NULL DEFAULT 'description',
  match_type TEXT NOT NULL DEFAULT 'contains',
  match_value TEXT NOT NULL,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  priority INT NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_rules TO authenticated;
GRANT ALL ON public.import_rules TO service_role;
ALTER TABLE public.import_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "household rules" ON public.import_rules FOR ALL TO authenticated
  USING (public.has_household_access(household_id)) WITH CHECK (public.has_household_access(household_id));

CREATE TABLE public.recurring_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  type public.txn_type NOT NULL,
  cadence TEXT NOT NULL DEFAULT 'monthly',
  next_run DATE NOT NULL,
  auto_post BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurring_templates TO authenticated;
GRANT ALL ON public.recurring_templates TO service_role;
ALTER TABLE public.recurring_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "household recurring" ON public.recurring_templates FOR ALL TO authenticated
  USING (public.has_household_access(household_id)) WITH CHECK (public.has_household_access(household_id));

-- =========================================
-- updated_at trigger
-- =========================================
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_profiles_upd BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_accounts_upd BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_txns_upd BEFORE UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================
-- Default categories seeder + new-user bootstrap
-- =========================================
CREATE OR REPLACE FUNCTION public.seed_default_categories(_household_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  parent_id UUID;
  v RECORD;
BEGIN
  FOR v IN
    SELECT * FROM (VALUES
      ('Food & Dining', 'expense', ARRAY['Groceries','Eating Out','Food Delivery']),
      ('Transport', 'expense', ARRAY['Fuel','Auto/Cab','Public Transport','Vehicle Maintenance']),
      ('Housing', 'expense', ARRAY['Rent','Maintenance/Society','Electricity','Water','Gas']),
      ('Household Help', 'expense', ARRAY['Maid','Cook','Driver']),
      ('Communication', 'expense', ARRAY['Mobile','Internet','DTH/OTT']),
      ('Health', 'expense', ARRAY['Doctor','Medicines','Health Insurance']),
      ('Education', 'expense', ARRAY['Fees','Tuition','Books']),
      ('Family & Festivals', 'expense', ARRAY['Weddings','Festival Shopping','Gifting','Pooja/Religious']),
      ('EMIs & Loans', 'expense', ARRAY[]::TEXT[]),
      ('Investments & Savings', 'expense', ARRAY['SIP','Lumpsum','PPF','NPS']),
      ('Personal Care', 'expense', ARRAY[]::TEXT[]),
      ('Shopping', 'expense', ARRAY['Clothing','Electronics','Online Shopping']),
      ('Travel & Vacation', 'expense', ARRAY[]::TEXT[]),
      ('Entertainment', 'expense', ARRAY[]::TEXT[]),
      ('Taxes', 'expense', ARRAY[]::TEXT[]),
      ('Insurance Premiums', 'expense', ARRAY[]::TEXT[]),
      ('Charity/Donation', 'expense', ARRAY[]::TEXT[]),
      ('Miscellaneous', 'expense', ARRAY[]::TEXT[]),
      ('Salary', 'income', ARRAY[]::TEXT[]),
      ('Business Income', 'income', ARRAY[]::TEXT[]),
      ('Interest', 'income', ARRAY[]::TEXT[]),
      ('Dividends', 'income', ARRAY[]::TEXT[]),
      ('Rental Income', 'income', ARRAY[]::TEXT[]),
      ('Other Income', 'income', ARRAY[]::TEXT[])
    ) AS t(name, kind, subs)
  LOOP
    INSERT INTO public.categories(household_id, parent_id, name, kind, is_system)
    VALUES (_household_id, NULL, v.name, v.kind, true)
    RETURNING id INTO parent_id;

    IF array_length(v.subs, 1) > 0 THEN
      INSERT INTO public.categories(household_id, parent_id, name, kind, is_system)
      SELECT _household_id, parent_id, s, v.kind, true FROM unnest(v.subs) s;
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_household UUID;
BEGIN
  INSERT INTO public.households(name, created_by)
  VALUES (COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)) || '''s Household', NEW.id)
  RETURNING id INTO new_household;

  INSERT INTO public.household_members(household_id, user_id, role)
  VALUES (new_household, NEW.id, 'admin');

  INSERT INTO public.profiles(id, display_name, default_household_id)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)), new_household);

  PERFORM public.seed_default_categories(new_household);

  RETURN NEW;
END $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
