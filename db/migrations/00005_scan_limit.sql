-- Kontrol jumlah email yang dipindai per sinkronisasi (jangan sedot semua).
-- +goose Up
ALTER TABLE gmail_connections ADD COLUMN IF NOT EXISTS scan_limit INT NOT NULL DEFAULT 100;
