-- Fase review & observability (PLAN §7). Idempoten.
-- +goose Up
ALTER TABLE raw_emails ADD COLUMN IF NOT EXISTS parser_version TEXT NOT NULL DEFAULT 'v1';
ALTER TABLE raw_emails ADD COLUMN IF NOT EXISTS error TEXT;

-- amount 0 diizinkan HANYA untuk needs_review (nominal gagal diparse, user isi manual).
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_amount_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_amount_check CHECK (amount >= 0);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_user_created_idx ON audit_logs (user_id, created_at DESC);

-- Mempercepat laporan: ringkasan per user/bulan.
CREATE INDEX IF NOT EXISTS transactions_user_occurred_idx
  ON transactions (user_id, occurred_at DESC) WHERE deleted_at IS NULL;
