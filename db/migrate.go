// Package db menjalankan migrasi goose yang di-embed.
package db

import (
	"context"
	"embed"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

//go:embed migrations/*.sql
var migrations embed.FS

// Migrate goose up ke DATABASE_URL. No-op bila kosong (dev UI tanpa DB).
func Migrate(ctx context.Context, databaseURL string) error {
	if databaseURL == "" {
		return nil
	}
	cfg, err := pgx.ParseConfig(databaseURL)
	if err != nil {
		return err
	}
	sqlDB := stdlib.OpenDB(*cfg)
	defer sqlDB.Close()
	goose.SetBaseFS(migrations)
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	return goose.UpContext(ctx, sqlDB, "migrations")
}
