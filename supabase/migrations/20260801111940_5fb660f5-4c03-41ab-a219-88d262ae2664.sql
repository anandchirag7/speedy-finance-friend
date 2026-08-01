-- 1. Global merchant dictionary (shared across all users)
CREATE TYPE public.merchant_confidence_source AS ENUM ('seed', 'ai_classified', 'user_confirmed');

CREATE TABLE public.global_merchant_dictionary (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  normalized_pattern text NOT NULL UNIQUE,
  canonical_payee_name text NOT NULL,
  suggested_category text,
  confidence_source public.merchant_confidence_source NOT NULL DEFAULT 'ai_classified',
  times_matched integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_gmd_pattern ON public.global_merchant_dictionary (normalized_pattern);

GRANT SELECT ON public.global_merchant_dictionary TO authenticated;
GRANT ALL ON public.global_merchant_dictionary TO service_role;

ALTER TABLE public.global_merchant_dictionary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dictionary is readable by authenticated users"
  ON public.global_merchant_dictionary FOR SELECT TO authenticated USING (true);

CREATE TRIGGER trg_gmd_updated_at BEFORE UPDATE ON public.global_merchant_dictionary
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. Per-user overrides
CREATE TABLE public.user_payee_overrides (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  normalized_pattern text NOT NULL,
  payee_name text,
  category text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, normalized_pattern)
);

CREATE INDEX idx_upo_user_pattern ON public.user_payee_overrides (user_id, normalized_pattern);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_payee_overrides TO authenticated;
GRANT ALL ON public.user_payee_overrides TO service_role;

ALTER TABLE public.user_payee_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own payee overrides"
  ON public.user_payee_overrides FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_upo_updated_at BEFORE UPDATE ON public.user_payee_overrides
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Statement upload progress
CREATE TYPE public.statement_upload_status AS ENUM ('parsing', 'deduplicating', 'classifying', 'complete', 'failed');

CREATE TABLE public.statement_uploads (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  household_id uuid REFERENCES public.households(id) ON DELETE CASCADE,
  filename text NOT NULL,
  status public.statement_upload_status NOT NULL DEFAULT 'parsing',
  total_transactions integer NOT NULL DEFAULT 0,
  processed_transactions integer NOT NULL DEFAULT 0,
  unique_patterns integer NOT NULL DEFAULT 0,
  error text,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_statement_uploads_user ON public.statement_uploads (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.statement_uploads TO authenticated;
GRANT ALL ON public.statement_uploads TO service_role;

ALTER TABLE public.statement_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own statement uploads"
  ON public.statement_uploads FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_statement_uploads_updated_at BEFORE UPDATE ON public.statement_uploads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.statement_uploads;
ALTER TABLE public.statement_uploads REPLICA IDENTITY FULL;

-- 4. transactions.normalized_pattern
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS normalized_pattern text;
CREATE INDEX IF NOT EXISTS idx_transactions_normalized_pattern
  ON public.transactions (household_id, normalized_pattern);

-- 5. Seed data
INSERT INTO public.global_merchant_dictionary (normalized_pattern, canonical_payee_name, suggested_category, confidence_source) VALUES
('SWIGGY', 'Swiggy', 'Food & Dining', 'seed'),
('SWIGGY INSTAMART', 'Swiggy Instamart', 'Groceries', 'seed'),
('ZOMATO', 'Zomato', 'Food & Dining', 'seed'),
('BLINKIT', 'Blinkit', 'Groceries', 'seed'),
('ZEPTO', 'Zepto', 'Groceries', 'seed'),
('BIGBASKET', 'BigBasket', 'Groceries', 'seed'),
('DUNZO', 'Dunzo', 'Groceries', 'seed'),
('DOMINOS', 'Dominos Pizza', 'Food & Dining', 'seed'),
('MCDONALDS', 'McDonalds', 'Food & Dining', 'seed'),
('STARBUCKS', 'Starbucks', 'Food & Dining', 'seed'),
('KFC', 'KFC', 'Food & Dining', 'seed'),
('AMAZON', 'Amazon', 'Shopping', 'seed'),
('AMAZON PAY', 'Amazon Pay', 'Shopping', 'seed'),
('FLIPKART', 'Flipkart', 'Shopping', 'seed'),
('MYNTRA', 'Myntra', 'Shopping', 'seed'),
('AJIO', 'Ajio', 'Shopping', 'seed'),
('NYKAA', 'Nykaa', 'Shopping', 'seed'),
('MEESHO', 'Meesho', 'Shopping', 'seed'),
('IKEA', 'IKEA', 'Shopping', 'seed'),
('DECATHLON', 'Decathlon', 'Shopping', 'seed'),
('RELIANCE RETAIL', 'Reliance Retail', 'Shopping', 'seed'),
('DMART', 'DMart', 'Groceries', 'seed'),
('UBER', 'Uber', 'Transport', 'seed'),
('OLA', 'Ola', 'Transport', 'seed'),
('RAPIDO', 'Rapido', 'Transport', 'seed'),
('IRCTC', 'IRCTC', 'Travel', 'seed'),
('MAKEMYTRIP', 'MakeMyTrip', 'Travel', 'seed'),
('GOIBIBO', 'Goibibo', 'Travel', 'seed'),
('INDIGO', 'IndiGo', 'Travel', 'seed'),
('REDBUS', 'redBus', 'Travel', 'seed'),
('OYO', 'OYO', 'Travel', 'seed'),
('INDIAN OIL', 'Indian Oil', 'Fuel', 'seed'),
('HP PETROL', 'HP Petrol', 'Fuel', 'seed'),
('BHARAT PETROLEUM', 'Bharat Petroleum', 'Fuel', 'seed'),
('NETFLIX', 'Netflix', 'Entertainment', 'seed'),
('HOTSTAR', 'Disney+ Hotstar', 'Entertainment', 'seed'),
('SPOTIFY', 'Spotify', 'Entertainment', 'seed'),
('YOUTUBE', 'YouTube', 'Entertainment', 'seed'),
('BOOKMYSHOW', 'BookMyShow', 'Entertainment', 'seed'),
('PVR', 'PVR Cinemas', 'Entertainment', 'seed'),
('APPLE', 'Apple', 'Subscriptions', 'seed'),
('GOOGLE', 'Google', 'Subscriptions', 'seed'),
('MICROSOFT', 'Microsoft', 'Subscriptions', 'seed'),
('AIRTEL', 'Airtel', 'Bills & Utilities', 'seed'),
('JIO', 'Jio', 'Bills & Utilities', 'seed'),
('VODAFONE IDEA', 'Vi', 'Bills & Utilities', 'seed'),
('BSNL', 'BSNL', 'Bills & Utilities', 'seed'),
('TATA POWER', 'Tata Power', 'Bills & Utilities', 'seed'),
('BESCOM', 'BESCOM', 'Bills & Utilities', 'seed'),
('ADANI ELECTRICITY', 'Adani Electricity', 'Bills & Utilities', 'seed'),
('MSEB', 'MSEDCL', 'Bills & Utilities', 'seed'),
('INDANE GAS', 'Indane Gas', 'Bills & Utilities', 'seed'),
('LIC', 'LIC', 'Insurance', 'seed'),
('POLICYBAZAAR', 'PolicyBazaar', 'Insurance', 'seed'),
('HDFC LIFE', 'HDFC Life', 'Insurance', 'seed'),
('ICICI PRUDENTIAL', 'ICICI Prudential', 'Insurance', 'seed'),
('STAR HEALTH', 'Star Health', 'Insurance', 'seed'),
('ZERODHA', 'Zerodha', 'Investments', 'seed'),
('GROWW', 'Groww', 'Investments', 'seed'),
('UPSTOX', 'Upstox', 'Investments', 'seed'),
('COIN ZERODHA', 'Zerodha Coin', 'Investments', 'seed'),
('KUVERA', 'Kuvera', 'Investments', 'seed'),
('PHONEPE', 'PhonePe', 'Transfers', 'seed'),
('GOOGLE PAY', 'Google Pay', 'Transfers', 'seed'),
('PAYTM', 'Paytm', 'Transfers', 'seed'),
('CRED', 'CRED', 'Loans & EMI', 'seed'),
('APOLLO PHARMACY', 'Apollo Pharmacy', 'Health & Medical', 'seed'),
('PHARMEASY', 'PharmEasy', 'Health & Medical', 'seed'),
('1MG', 'Tata 1mg', 'Health & Medical', 'seed'),
('PRACTO', 'Practo', 'Health & Medical', 'seed'),
('CULT FIT', 'Cultfit', 'Health & Medical', 'seed'),
('URBAN COMPANY', 'Urban Company', 'Personal Care', 'seed'),
('UDEMY', 'Udemy', 'Education', 'seed'),
('COURSERA', 'Coursera', 'Education', 'seed'),
('BYJUS', 'Byjus', 'Education', 'seed'),
('UNACADEMY', 'Unacademy', 'Education', 'seed')
ON CONFLICT (normalized_pattern) DO NOTHING;