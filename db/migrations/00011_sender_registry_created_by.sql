-- Sender registry bisa ditambah manual oleh user. created_by = pembuat (NULL
-- untuk seed bawaan). Hanya pembuat yang boleh menghapus; seed tidak bisa.
-- +goose Up
ALTER TABLE sender_registry ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE CASCADE;
