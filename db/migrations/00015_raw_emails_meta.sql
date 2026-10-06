-- Detail riwayat sync per email: butuh subjek + domain pengirim + waktu
-- insert (sebelumnya tidak disimpan demi privasi). Body email tetap TIDAK
-- disimpan; yang ditambah hanya metadata ringan. Baris lama terisi NULL.
-- +goose Up
ALTER TABLE raw_emails ADD COLUMN IF NOT EXISTS subject TEXT;
ALTER TABLE raw_emails ADD COLUMN IF NOT EXISTS sender_domain TEXT;
ALTER TABLE raw_emails ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS raw_emails_conn_created_idx ON raw_emails (connection_id, created_at DESC);

-- +goose Down
DROP INDEX IF EXISTS raw_emails_conn_created_idx;
ALTER TABLE raw_emails DROP COLUMN IF EXISTS created_at;
ALTER TABLE raw_emails DROP COLUMN IF EXISTS sender_domain;
ALTER TABLE raw_emails DROP COLUMN IF EXISTS subject;
