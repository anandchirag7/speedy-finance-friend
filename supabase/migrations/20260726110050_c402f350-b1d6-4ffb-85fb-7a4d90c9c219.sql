ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS whatsapp_number TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_reminders_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS whatsapp_number TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_enabled BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.bill_reminder_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  bill_id UUID NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,
  due_date DATE NOT NULL,
  days_before INT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  recipient TEXT,
  provider_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  error TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bill_id, due_date, days_before, channel)
);

GRANT SELECT ON public.bill_reminder_sends TO authenticated;
GRANT ALL ON public.bill_reminder_sends TO service_role;

ALTER TABLE public.bill_reminder_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Household members can view reminder sends"
  ON public.bill_reminder_sends FOR SELECT
  TO authenticated
  USING (public.has_household_access(household_id));

CREATE INDEX IF NOT EXISTS idx_bill_reminder_sends_bill ON public.bill_reminder_sends(bill_id, due_date);