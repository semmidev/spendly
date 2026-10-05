package app

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/semmidev/spendly/internal/modules/extraction"
	"github.com/semmidev/spendly/internal/modules/identity"
	"github.com/semmidev/spendly/internal/modules/ledger"
	"github.com/semmidev/spendly/internal/modules/mailsync"
	"github.com/semmidev/spendly/internal/modules/reporting"
	"github.com/semmidev/spendly/internal/platform/config"
	"github.com/semmidev/spendly/internal/platform/middleware"
	"github.com/semmidev/spendly/internal/platform/security"
	"github.com/semmidev/spendly/internal/platform/web"
	spaweb "github.com/semmidev/spendly/internal/web"
)

// Budget waktu per kelompok route. Sync memanggil Gmail + AI sehingga jauh
// lebih lama daripada CRUD biasa. Tanpa timeout global agar sync tidak
// dipotong (dulu menyebabkan "superfluous response.WriteHeader").
const (
	authTimeout    = 20 * time.Second
	apiTimeout     = 15 * time.Second
	extractTimeout = 30 * time.Second
	syncTimeout    = 180 * time.Second
)

func BuildRouter(cfg *config.Config, pool *pgxpool.Pool, store *ledger.Store, enc *security.AESEncryptor, mailSvc *mailsync.Service, extractSvc *extraction.Service) chi.Router {
	r := chi.NewRouter()
	r.Use(chimw.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.CORSAllowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Content-Type", "X-CSRF-Token"},
		AllowCredentials: true,
	}))
	r.Use(middleware.CSRF)
	r.Use(middleware.BodyLimit(middleware.MaxBodyBytes))

	r.Get("/health/live", func(w http.ResponseWriter, r *http.Request) {
		web.JSON(w, http.StatusOK, map[string]any{"status": "ok", "service": cfg.AppName})
	})
	r.Get("/health/ready", func(w http.ResponseWriter, r *http.Request) {
		if err := pool.Ping(r.Context()); err != nil {
			web.JSON(w, http.StatusServiceUnavailable, map[string]any{"status": "unavailable", "database": "unreachable"})
			return
		}
		web.JSON(w, http.StatusOK, map[string]any{"status": "ok", "database": "reachable"})
	})

	r.Get("/version", func(w http.ResponseWriter, r *http.Request) {
		web.Success(w, http.StatusOK, "Versi aplikasi", config.GetBuildInfo(cfg.AppEnv), nil)
	})

	r.Route("/api/v1", func(r chi.Router) {
		r.Use(middleware.RateLimit(120, time.Minute))

		// Auth & OAuth handshake jalan tanpa sesi.
		r.With(chimw.Timeout(authTimeout)).Group(func(r chi.Router) {
			identity.NewHandler(cfg, pool, enc).Mount(r)
		})

		// Semua endpoint data butuh sesi.
		r.Group(func(r chi.Router) {
			r.Use(middleware.Session(pool))

			// CRUD cepat.
			r.With(chimw.Timeout(apiTimeout)).Group(func(r chi.Router) {
				ledger.NewHandler(store).Mount(r)
				reporting.NewHandler(store).Mount(r)
			})

			mailsyncSvc := mailSvc
			if mailsyncSvc == nil {
				mailsyncSvc = mailsync.NewService(pool, cfg, enc)
			}
			// AI mengekstrak, kode menghitung: extraction memenuhi
			// mailsync.Extractor agar sync inline langsung memproses email baru.
			if extractSvc == nil && pool != nil {
				extractSvc = extraction.NewService(pool, cfg, mailsyncSvc)
			}
			mailsyncSvc.Extract = extractSvc

			// Sync/temukan pengirim: Gmail + AI, butuh budget panjang.
			r.With(chimw.Timeout(syncTimeout)).Group(func(r chi.Router) {
				mailsync.NewHandler(mailsyncSvc).Mount(r)
			})
			if extractSvc != nil {
				r.With(chimw.Timeout(extractTimeout)).Group(func(r chi.Router) {
					extraction.NewHandler(extractSvc, store).Mount(r)
				})
			}
		})
	})

	// SPA: sajikan frontend hasil build dari binary (satu proses, tanpa dev-server).
	if spaweb.IsFrontendBundled() {
		if h, err := spaweb.NewSPAHandler(); err == nil {
			r.Handle("/*", h)
		}
	}

	return r
}
