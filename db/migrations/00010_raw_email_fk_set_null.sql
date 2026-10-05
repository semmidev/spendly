-- Putus Gmail harus bisa menghapus koneksi + raw_emails tanpa ikut menghapus
-- transaksi user. Ubah FK raw_email_id menjadi ON DELETE SET NULL: transaksi
-- tetap ada, hanya tautan ke email sumber yang dibuang.
-- +goose Up
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_raw_email_id_fkey;
ALTER TABLE transactions ADD CONSTRAINT transactions_raw_email_id_fkey
  FOREIGN KEY (raw_email_id) REFERENCES raw_emails(id) ON DELETE SET NULL;
