
ALTER TABLE public.memorized_payees
  ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS match_tokens text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS memorized_payees_aliases_gin
  ON public.memorized_payees USING GIN (aliases);

CREATE INDEX IF NOT EXISTS memorized_payees_match_tokens_gin
  ON public.memorized_payees USING GIN (match_tokens);

-- Backfill helper: normalize a raw description into a compact fingerprint.
CREATE OR REPLACE FUNCTION public._normalize_desc_for_cluster(s text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT
    left(
      trim(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(upper(coalesce(s,'')), '\y\d{4,}\y', ' ', 'g'),
                '\y\d{1,2}[\/\-][A-Z0-9]{2,}[\/\-]?\d{0,4}\y', ' ', 'g'
              ),
              '\y(UPI|NEFT|IMPS|RTGS|POS|ATM|TXN|REF|TRF|PAYMENT|PMT|PUR|DEBIT|CREDIT|INR|RS)\y', ' ', 'g'
            ),
            '[^A-Z0-9&@ ]+', ' ', 'g'
          ),
          '\s+', ' ', 'g'
        )
      ),
      80
    );
$$;

-- Backfill helper: significant tokens from a payee name.
CREATE OR REPLACE FUNCTION public._match_tokens_for_name(s text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT t), '{}'::text[])
  FROM (
    SELECT unnest(
      string_to_array(
        regexp_replace(
          regexp_replace(upper(coalesce(s,'')), '[^A-Z0-9 ]+', ' ', 'g'),
          '\s+', ' ', 'g'
        ),
        ' '
      )
    ) AS t
  ) x
  WHERE length(t) >= 3
    AND t !~ '^\d+$'
    AND t NOT IN (
      'UPI','NEFT','IMPS','RTGS','POS','ATM','TXN','REF','TRF','PAYMENT','PMT','PUR','DEBIT','CREDIT',
      'INR','RS','DR','CR','ACH','NACH','ECS','BIL','BILL','ONLINE','BANK','TRANSFER','WDL','WITHDRAWAL',
      'CARD','VISA','MASTERCARD','RUPAY','PAYTM','PHONEPE','GPAY','GOOGLE','BHIM','PAY','PVT','LTD',
      'LIMITED','PRIVATE','INDIA','IND'
    );
$$;

-- Backfill aliases from existing linked transactions (by merchant name match).
WITH normalized AS (
  SELECT
    p.id AS payee_id,
    public._normalize_desc_for_cluster(coalesce(t.note, t.merchant)) AS fingerprint
  FROM public.memorized_payees p
  JOIN public.transactions t
    ON t.household_id = p.household_id
   AND lower(trim(coalesce(t.merchant,''))) = lower(trim(p.merchant))
  WHERE coalesce(t.note, t.merchant) IS NOT NULL
),
agg AS (
  SELECT payee_id, array_agg(DISTINCT fingerprint) FILTER (WHERE fingerprint <> '') AS aliases
  FROM normalized
  GROUP BY payee_id
)
UPDATE public.memorized_payees p
SET aliases = COALESCE(a.aliases, '{}'::text[])
FROM agg a
WHERE a.payee_id = p.id;

-- Backfill match_tokens from merchant + aliases.
UPDATE public.memorized_payees p
SET match_tokens = (
  SELECT COALESCE(array_agg(DISTINCT tok), '{}'::text[])
  FROM (
    SELECT unnest(public._match_tokens_for_name(p.merchant)) AS tok
    UNION
    SELECT unnest(public._match_tokens_for_name(a)) AS tok
    FROM unnest(p.aliases) a
  ) x
  WHERE tok IS NOT NULL AND tok <> ''
);
