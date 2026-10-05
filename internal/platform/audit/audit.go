// Package audit mencatat aksi sensitif ke tabel audit_logs (PLAN §7).
package audit

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Record menulis satu baris audit. Kegagalan audit tidak boleh menggagalkan
// operasi utama, jadi error diabaikan (best-effort).
func Record(ctx context.Context, pool *pgxpool.Pool, userID, action, target string, metadata map[string]any) {
	if userID == "" {
		return
	}
	if metadata == nil {
		metadata = map[string]any{}
	}
	_, _ = pool.Exec(ctx, `INSERT INTO audit_logs (user_id, action, target, metadata)
		VALUES ($1::uuid,$2,$3,$4)`, userID, action, target, metadata)
}
