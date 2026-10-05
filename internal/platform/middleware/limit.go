package middleware

import (
	"net/http"
	"time"

	"github.com/go-chi/httprate"
)

// MaxBodyBytes membatasi ukuran body request (mencegah payload raksasa).
const MaxBodyBytes = 1 << 20 // 1 MiB

// BodyLimit membungkus body dengan MaxBytesReader.
func BodyLimit(limit int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Body != nil {
				r.Body = http.MaxBytesReader(w, r.Body, limit)
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RateLimit membatasi request per IP. Endpoint AI/sync lebih ketat karena mahal.
func RateLimit(requests int, window time.Duration) func(http.Handler) http.Handler {
	return httprate.LimitByIP(requests, window)
}
