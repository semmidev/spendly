package middleware

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/semmidev/spendly/internal/platform/apperr"
	"github.com/semmidev/spendly/internal/platform/web"
)

const (
	SessionCookie = "session_id"
	CSRFCookie    = "csrf_token"
	CSRFHeader    = "X-CSRF-Token"
)

// Session memvalidasi cookie sesi ke tabel sessions (PostgreSQL).
func Session(pool *pgxpool.Pool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			c, err := r.Cookie(SessionCookie)
			if err != nil || c.Value == "" {
				web.Error(w, r, errUnauthorized())
				return
			}
			var uid string
			err = pool.QueryRow(r.Context(), `SELECT user_id::text FROM sessions
				WHERE id=$1::uuid AND expires_at>now()`, c.Value).Scan(&uid)
			if err != nil {
				web.Error(w, r, errUnauthorized())
				return
			}
			next.ServeHTTP(w, r.WithContext(web.WithUser(r.Context(), uid)))
		})
	}
}

// CSRF double-submit: cookie terbaca vs header. Dilewati bila belum ada cookie
// CSRF sama sekali (mode dev tanpa login — tidak ada sesi yang dilindungi),
// untuk GET/HEAD/OPTIONS, dan endpoint handshake auth.
func CSRF(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			next.ServeHTTP(w, r)
			return
		}
		if isAuthHandshake(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		cookie, err := r.Cookie(CSRFCookie)
		if err != nil || cookie.Value == "" {
			next.ServeHTTP(w, r)
			return
		}
		if r.Header.Get(CSRFHeader) != cookie.Value {
			http.Error(w, `{"success":false,"code":"FORBIDDEN","message":"CSRF token tidak valid"}`, http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func isAuthHandshake(p string) bool {
	for _, s := range []string{"/auth/login", "/auth/logout", "/auth/refresh", "/auth/google/", "/gmail/callback"} {
		if strings.Contains(p, s) {
			return true
		}
	}
	return false
}

func RandomToken(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func errUnauthorized() error {
	return apperr.Unauthorized("sesi tidak valid, silakan login kembali")
}
