package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	spendlydb "github.com/semmidev/spendly/db"
	"github.com/semmidev/spendly/internal/app"
	"github.com/semmidev/spendly/internal/modules/extraction"
	"github.com/semmidev/spendly/internal/modules/ledger"
	"github.com/semmidev/spendly/internal/modules/mailsync"
	"github.com/semmidev/spendly/internal/platform/config"
	"github.com/semmidev/spendly/internal/platform/db"
	"github.com/semmidev/spendly/internal/platform/security"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		fmt.Println("config:", err)
		os.Exit(1)
	}
	configureLogging(cfg)
	enc, err := security.NewAESEncryptor(cfg.AppEncryptionKey)
	if err != nil {
		fmt.Println("encryptor:", err)
		os.Exit(1)
	}
	slog.Info("AI config", "model", cfg.AIModel, "mode", cfg.AIAPIMode, "configured", cfg.AIConfigured())

	// Database wajib — tidak ada mode memori (production ready).
	if cfg.DatabaseURL == "" {
		fmt.Println("DATABASE_URL wajib diisi (contoh: postgres://spendly:spendly@localhost:5432/spendly?sslmode=disable)")
		os.Exit(1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := spendlydb.Migrate(ctx, cfg.DatabaseURL); err != nil {
		fmt.Println("migrate:", err)
		os.Exit(1)
	}
	pool := db.Open(context.Background(), cfg.DatabaseURL)
	if pool == nil {
		fmt.Println("gagal membuka koneksi database")
		os.Exit(1)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		fmt.Println("database tidak terjangkau:", err)
		os.Exit(1)
	}

	// User dev hanya untuk pengembangan lokal (bukan produksi).
	if !cfg.IsProduction() {
		ledger.EnsureDevUser(context.Background(), pool)
	}
	store := ledger.NewStorePG(pool)
	mailSvc := mailsync.NewService(pool, cfg, enc)
	extractSvc := extraction.NewService(pool, cfg, mailSvc)
	mailSvc.Extract = extractSvc
	// Job sync yang tertinggal (server mati / ganti device di tengah jalan)
	// ditandai error agar daftar aktif tidak menggantung.
	if n, err := mailSvc.RecoverStaleJobs(ctx); err == nil && n > 0 {
		slog.Warn("job sync tertinggal ditandai error", "count", n)
	}

	srv := &http.Server{
		Addr:         ":" + cfg.AppPort,
		Handler:      app.BuildRouter(cfg, pool, store, enc, mailSvc, extractSvc),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 200 * time.Second, // > syncTimeout (180s) agar sync tidak terpotong
		IdleTimeout:  60 * time.Second,
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	go func() {
		slog.Info("spendly listening", "port", cfg.AppPort)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			fmt.Println("server:", err)
			os.Exit(1)
		}
	}()

	<-stop
	slog.Info("mematikan server…")
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("shutdown paksa", "error", err)
	}
	slog.Info("server berhenti")
}

// configureLogging: teks (dev) atau JSON (produksi), level dari LOG_LEVEL.
func configureLogging(cfg *config.Config) {
	level := slog.LevelInfo
	switch strings.ToLower(cfg.LogLevel) {
	case "debug":
		level = slog.LevelDebug
	case "warn", "warning":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	}
	opts := &slog.HandlerOptions{Level: level}
	var h slog.Handler
	if cfg.IsProduction() {
		h = slog.NewJSONHandler(os.Stdout, opts)
	} else {
		h = slog.NewTextHandler(os.Stdout, opts)
	}
	slog.SetDefault(slog.New(h))
}
