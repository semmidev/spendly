package keepalive

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// Start meming endpoint kesehatan sendiri dan layanan eksternal tiap interval agar scheduler
// Render free tidak menganggurkan instance (>15 mnt idle = sleep).
// No-op bila target kosong atau interval <= 0. Berhenti saat ctx dibatalkan.
// ponytail: satu ticker global, per-route jitter bila butuh sebar beban.
func Start(ctx context.Context, target string, interval time.Duration) {
	target = strings.TrimRight(strings.TrimSpace(target), "/")
	if target == "" || interval <= 0 {
		return
	}
	urls := []string{
		target + "/health/live",
		"https://info-gizi-bumil-remaja.onrender.com",
	}
	client := &http.Client{Timeout: 10 * time.Second}
	t := time.NewTicker(interval)
	slog.Info("self-ping aktif", "urls", urls, "interval", interval.String())
	go func() {
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				for _, u := range urls {
					req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
					if err != nil {
						continue
					}
					resp, err := client.Do(req)
					if err != nil {
						slog.Warn("ping keepalive gagal", "url", u, "error", err)
						continue
					}
					resp.Body.Close()
					if resp.StatusCode >= 400 {
						slog.Warn("ping keepalive status buruk", "url", u, "status", resp.Status)
					} else {
						slog.Debug("ping keepalive ok", "url", u, "status", resp.Status)
					}
				}
			}
		}
	}()
}
