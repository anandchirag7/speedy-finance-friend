UPDATE public.dashboards
SET layout = (
  SELECT jsonb_agg(
    CASE
      WHEN item->>'type' = 'net-worth' AND (item->>'h')::int = 4 THEN jsonb_set(item, '{h}', '3'::jsonb)
      WHEN item->>'type' IN ('income','expenses','savings') AND (item->>'h')::int = 3 THEN jsonb_set(jsonb_set(item, '{h}', '2'::jsonb), '{y}', '3'::jsonb)
      WHEN item->>'type' IN ('net-worth-trend','cash-flow') AND (item->>'y')::int = 7 THEN jsonb_set(item, '{y}', '5'::jsonb)
      WHEN item->>'type' IN ('upcoming-bills','top-spending') AND (item->>'y')::int = 12 THEN jsonb_set(item, '{y}', '10'::jsonb)
      ELSE item
    END
  )
  FROM jsonb_array_elements(layout) AS item
)
WHERE template_key = 'personal-finance';