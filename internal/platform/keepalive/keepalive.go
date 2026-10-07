package keepalive

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// Start meming endpoint kesehatan sendiri tiap interval agar scheduler
// Render free tidak menganggurkan instance (>15 mnt idle = sleep).
// No-op bila target kosong atau interval <= 0. Berhenti saat ctx dibatalkan.
// ponytail: satu ticker global, per-route jitter bila butuh sebar beban.
func Start(ctx context.Context, target string, interval time.Duration) {
	target = strings.TrimRight(strings.TrimSpace(target), "/")
	if target == "" || interval <= 0 {
		return
	}
	url := target + "/health/live"
	client := &http.Client{Timeout: 10 * time.Second}
	t := time.NewTicker(interval)
	slog.Info("self-ping aktif", "url", url, "interval", interval.String())
	go func() {
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
				if err != nil {
					continue
				}
				resp, err := client.Do(req)
				if err != nil {
					slog.Warn("self-ping gagal", "error", err)
					continue
				}
				resp.Body.Close()
				if resp.StatusCode >= 400 {
					slog.Warn("self-ping status buruk", "status", resp.Status)
				} else {
					slog.Debug("self-ping ok", "status", resp.Status)
				}
			}
		}
	}()
}
