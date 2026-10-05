-- Tambah kolom updated_at ke gmail_connections agar UPSERT token bisa mencatat waktu pembaruan.
-- +goose Up
ALTER TABLE gmail_connections ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
