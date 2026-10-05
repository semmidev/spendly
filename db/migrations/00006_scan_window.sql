-- Simpan pilihan jendela scan (agar 'Bulan ini' tidak berubah jadi 30 hari).
-- +goose Up
ALTER TABLE gmail_connections ADD COLUMN IF NOT EXISTS scan_window TEXT NOT NULL DEFAULT '30d';
