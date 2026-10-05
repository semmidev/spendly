-- Jendela scan kustom: user bisa memilih rentang tanggal bebas
-- (scan_window='custom'); scan_from/scan_to menyimpan batasnya.
-- +goose Up
ALTER TABLE gmail_connections ADD COLUMN IF NOT EXISTS scan_from DATE;
ALTER TABLE gmail_connections ADD COLUMN IF NOT EXISTS scan_to DATE;
