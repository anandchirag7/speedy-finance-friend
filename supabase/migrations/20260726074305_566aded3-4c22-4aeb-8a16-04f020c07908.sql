
ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS payee_id uuid REFERENCES public.memorized_payees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS auto_pay boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_days integer[] NOT NULL DEFAULT ARRAY[7,3,1]::integer[],
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS url text,
  ADD COLUMN IF NOT EXISTS is_estimated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_paid_on date,
  ADD COLUMN IF NOT EXISTS end_date date,
  ADD COLUMN IF NOT EXISTS min_amount numeric(18,2),
  ADD COLUMN IF NOT EXISTS max_amount numeric(18,2),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS bills_set_updated_at ON public.bills;
CREATE TRIGGER bills_set_updated_at BEFORE UPDATE ON public.bills
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS bills_household_due_idx ON public.bills(household_id, due_date);
CREATE INDEX IF NOT EXISTS bills_status_idx ON public.bills(household_id, status);

CREATE TABLE IF NOT EXISTS public.bill_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  bill_id uuid NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,
  due_date date NOT NULL,
  paid_date date,
  amount numeric(18,2),
  status text NOT NULL DEFAULT 'paid',
  transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bill_payments TO authenticated;
GRANT ALL ON public.bill_payments TO service_role;

ALTER TABLE public.bill_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "household bill_payments" ON public.bill_payments;
CREATE POLICY "household bill_payments" ON public.bill_payments FOR ALL TO authenticated
  USING (has_household_access(household_id)) WITH CHECK (has_household_access(household_id));

DROP TRIGGER IF EXISTS bill_payments_set_updated_at ON public.bill_payments;
CREATE TRIGGER bill_payments_set_updated_at BEFORE UPDATE ON public.bill_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS bill_payments_bill_idx ON public.bill_payments(bill_id, due_date DESC);
CREATE INDEX IF NOT EXISTS bill_payments_household_idx ON public.bill_payments(household_id, paid_date DESC);
