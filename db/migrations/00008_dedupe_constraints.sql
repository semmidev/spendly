-- Cegah duplikat koneksi Gmail & alias merchant; hapus kolom kategori tak terpakai.
-- +goose Up
-- Bersihkan duplikat lama (bila ada) sebelum pasang index unik.
DELETE FROM gmail_connections a USING gmail_connections b
WHERE a.ctid < b.ctid AND a.user_id = b.user_id AND a.google_email = b.google_email;
CREATE UNIQUE INDEX IF NOT EXISTS gmail_connections_user_email_uniq
  ON gmail_connections (user_id, google_email);

DELETE FROM merchant_aliases a USING merchant_aliases b
WHERE a.ctid < b.ctid AND a.merchant_id = b.merchant_id AND a.alias = b.alias;
CREATE UNIQUE INDEX IF NOT EXISTS merchant_aliases_merchant_alias_uniq
  ON merchant_aliases (merchant_id, alias);

-- icon/color kategori tidak dipakai (meta warna di frontend) → hapus.
ALTER TABLE categories DROP COLUMN IF EXISTS icon;
ALTER TABLE categories DROP COLUMN IF EXISTS color;
