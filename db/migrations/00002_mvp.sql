-- Aturan kategori dari koreksi user, langganan, ekstraksi AI, dan biaya AI.
-- +goose Up
CREATE TABLE IF NOT EXISTS rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_type TEXT NOT NULL DEFAULT 'merchant',
  pattern TEXT NOT NULL,
  category_id UUID REFERENCES categories(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, match_type, pattern)
);

CREATE TABLE IF NOT EXISTS recurring_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount BIGINT NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL DEFAULT 'IDR',
  merchant TEXT NOT NULL DEFAULT '',
  category_id UUID REFERENCES categories(id),
  cadence TEXT NOT NULL DEFAULT 'monthly',
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS extractions (
  raw_email_id UUID PRIMARY KEY REFERENCES raw_emails(id) ON DELETE CASCADE,
  model TEXT NOT NULL DEFAULT '',
  prompt_version TEXT NOT NULL DEFAULT 'v1',
  result_json JSONB NOT NULL DEFAULT '{}',
  confidence DOUBLE PRECISION,
  tokens_in INT NOT NULL DEFAULT 0,
  tokens_out INT NOT NULL DEFAULT 0,
  cost NUMERIC(12,6) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ai_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  feature TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL DEFAULT 'v1',
  tokens_in INT NOT NULL DEFAULT 0,
  tokens_out INT NOT NULL DEFAULT 0,
  cost NUMERIC(12,6) NOT NULL DEFAULT 0,
  latency_ms INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed sender rekomendasi Indonesia (PLAN §3.1)
INSERT INTO sender_registry (domain, label, is_seed, enabled) VALUES
  ('bca.co.id','BCA',true,true),
  ('bankmandiri.co.id','Mandiri',true,true),
  ('bni.co.id','BNI',true,true),
  ('bri.co.id','BRI',true,true),
  ('jago.com','Jago',true,true),
  ('seabank.co.id','SeaBank',true,true),
  ('gopay.co.id','GoPay',true,true),
  ('ovo.id','OVO',true,true),
  ('dana.id','DANA',true,true),
  ('shopee.co.id','Shopee',true,true),
  ('tokopedia.com','Tokopedia',true,true),
  ('grab.com','Grab',true,true),
  ('gojek.com','Gojek',true,true),
  ('traveloka.com','Traveloka',true,true)
ON CONFLICT (domain) DO NOTHING;
