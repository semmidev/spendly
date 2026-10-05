-- Job sinkronisasi Gmail dipersist agar progres/status selamat dari
-- ganti device maupun restart server. Sumber kebenaran untuk daftar aktif.
-- +goose Up
CREATE TABLE IF NOT EXISTS sync_jobs (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES gmail_connections(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running',
  mode TEXT NOT NULL DEFAULT 'backfill',
  days INT NOT NULL DEFAULT 30,
  scan_limit INT NOT NULL DEFAULT 100,
  processed INT NOT NULL DEFAULT 0,
  total INT NOT NULL DEFAULT 0,
  new_count INT NOT NULL DEFAULT 0,
  gated_count INT NOT NULL DEFAULT 0,
  extracted_count INT NOT NULL DEFAULT 0,
  current TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT 'menyiapkan',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sync_jobs_user_conn_idx ON sync_jobs (user_id, connection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sync_jobs_active_idx ON sync_jobs (connection_id, status) WHERE status IN ('running','paused');
