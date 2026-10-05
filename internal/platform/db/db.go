package db

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Open membuka pool pgx; kembalikan nil bila DATABASE_URL kosong (dev UI tanpa DB).
// ponytail: tanpa ORM — SQL langsung + sqlc menyusul saat query > 5.
func Open(ctx context.Context, databaseURL string) *pgxpool.Pool {
	if databaseURL == "" {
		return nil
	}
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil
	}
	cfg.MaxConns = 10
	cfg.MinConns = 1
	cfg.MaxConnLifetime = 15 * time.Minute
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil
	}
	return pool
}
