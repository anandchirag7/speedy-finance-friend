ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS import_email_notifications boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notification_email text;