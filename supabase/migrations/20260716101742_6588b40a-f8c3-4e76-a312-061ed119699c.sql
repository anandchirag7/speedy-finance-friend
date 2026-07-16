
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS group_label text,
  ADD COLUMN IF NOT EXISTS tax_code text,
  ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'personal';

-- allow investments/transfer kinds in addition to income/expense
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'categories_kind_check'
  ) THEN
    ALTER TABLE public.categories DROP CONSTRAINT categories_kind_check;
  END IF;
END $$;

ALTER TABLE public.categories
  ADD CONSTRAINT categories_kind_check
  CHECK (kind IN ('income','expense','transfer','investment'));

ALTER TABLE public.categories
  ADD CONSTRAINT categories_scope_check
  CHECK (scope IN ('personal','business'));
