-- Satu email = maksimal satu transaksi. Duplikat lama dibersihkan dulu (simpan
-- yang belum dihapus & paling awal), lalu pasang unique index parsial.
-- +goose Up
DELETE FROM transactions
WHERE raw_email_id IS NOT NULL
  AND id NOT IN (
    SELECT DISTINCT ON (raw_email_id) id
    FROM transactions
    WHERE raw_email_id IS NOT NULL
    ORDER BY raw_email_id, (deleted_at IS NULL) DESC, created_at ASC, id
  );

CREATE UNIQUE INDEX IF NOT EXISTS transactions_raw_email_id_uniq
  ON transactions (raw_email_id)
  WHERE raw_email_id IS NOT NULL;
