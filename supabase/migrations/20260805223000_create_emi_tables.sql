-- Migration: Create EMI Plans and EMI Installments tables and add index on transactions.split_parent_id

-- 1. Index on transactions.split_parent_id for fast parent-child hierarchy queries
CREATE INDEX IF NOT EXISTS idx_transactions_split_parent_id ON public.transactions(split_parent_id);

-- 2. Create emi_plans table
CREATE TABLE IF NOT EXISTS public.emi_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  origin_transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  merchant_name text NOT NULL,
  total_principal numeric NOT NULL,
  interest_rate numeric DEFAULT 0,
  tenure_months integer NOT NULL,
  monthly_installment numeric NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.emi_plans ENABLE ROW LEVEL SECURITY;

-- RLS Policy for emi_plans
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'emi_plans' AND policyname = 'Users can access household emi_plans'
  ) THEN
    CREATE POLICY "Users can access household emi_plans"
      ON public.emi_plans
      FOR ALL
      USING (household_id IN (
        SELECT household_id FROM public.household_members WHERE user_id = auth.uid()
      ));
  END IF;
END $$;

-- 3. Create emi_installments table
CREATE TABLE IF NOT EXISTS public.emi_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  emi_plan_id uuid NOT NULL REFERENCES public.emi_plans(id) ON DELETE CASCADE,
  due_date date NOT NULL,
  principal_amount numeric DEFAULT 0,
  interest_amount numeric DEFAULT 0,
  total_amount numeric NOT NULL,
  installment_number integer NOT NULL,
  paid boolean NOT NULL DEFAULT false,
  transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.emi_installments ENABLE ROW LEVEL SECURITY;

-- RLS Policy for emi_installments
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'emi_installments' AND policyname = 'Users can access household emi_installments'
  ) THEN
    CREATE POLICY "Users can access household emi_installments"
      ON public.emi_installments
      FOR ALL
      USING (emi_plan_id IN (
        SELECT id FROM public.emi_plans WHERE household_id IN (
          SELECT household_id FROM public.household_members WHERE user_id = auth.uid()
        )
      ));
  END IF;
END $$;
