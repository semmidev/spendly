// Package testutil menyediakan infrastruktur test nyata (Postgres via
// testcontainers) sehingga migrasi + query dieksekusi sungguhan, bukan mock.
package testutil

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"

	spendlydb "github.com/semmidev/spendly/db"
	"github.com/semmidev/spendly/internal/platform/db"
)

// StartPostgres menyalakan Postgres 16 ephemeral, menjalankan seluruh migrasi
// goose, lalu mengembalikan pool siap pakai. Otomatis t.Skip bila Docker mati.
func StartPostgres(t *testing.T) *pgxpool.Pool {
	t.Helper()
	testcontainers.SkipIfProviderIsNotHealthy(t)

	ctx := context.Background()
	ctr, err := postgres.Run(ctx, "postgres:16-alpine",
		postgres.WithDatabase("spendly"),
		postgres.WithUsername("spendly"),
		postgres.WithPassword("spendly"),
		postgres.BasicWaitStrategies(),
	)
	if err != nil {
		t.Fatalf("start postgres container: %v", err)
	}
	t.Cleanup(func() { _ = ctr.Terminate(context.Background()) })

	dsn, err := ctr.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("connection string: %v", err)
	}
	if err := spendlydb.Migrate(ctx, dsn); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	pool := db.Open(ctx, dsn)
	if pool == nil {
		t.Fatal("pool nil setelah Open")
	}
	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}
