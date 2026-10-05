-- Spendly MVP schema (PLAN §7). Uang = BIGINT minor + currency.
-- +goose Up
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE gmail_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  google_email TEXT NOT NULL,
  enc_refresh_token TEXT NOT NULL,
  history_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  last_synced_at TIMESTAMPTZ,
  backfill_days INT NOT NULL DEFAULT 30
);

CREATE TABLE sender_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  is_seed BOOLEAN NOT NULL DEFAULT false,
  enabled BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE user_senders (
  connection_id UUID NOT NULL REFERENCES gmail_connections(id) ON DELETE CASCADE,
  sender_domain TEXT NOT NULL,
  allowed BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (connection_id, sender_domain)
);

CREATE TABLE raw_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES gmail_connections(id) ON DELETE CASCADE,
  gmail_message_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'fetched',
  ignore_reason TEXT,
  received_at TIMESTAMPTZ,
  UNIQUE (connection_id, gmail_message_id)
);

CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  icon TEXT,
  color TEXT
);

CREATE TABLE merchants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  canonical_name TEXT NOT NULL,
  default_category_id UUID REFERENCES categories(id)
);

CREATE TABLE merchant_aliases (
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  alias TEXT NOT NULL
);
CREATE INDEX merchant_aliases_trgm ON merchant_aliases USING gin (alias gin_trgm_ops);

CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount BIGINT NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL DEFAULT 'IDR',
  occurred_at TIMESTAMPTZ NOT NULL,
  merchant_id UUID REFERENCES merchants(id),
  category_id UUID REFERENCES categories(id),
  payment_source TEXT,
  note TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  raw_email_id UUID REFERENCES raw_emails(id),
  reference_no TEXT,
  fingerprint TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'confirmed',
  duplicate_of UUID REFERENCES transactions(id),
  confidence DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
