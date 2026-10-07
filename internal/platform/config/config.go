package config

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	AppName            string
	AppEnv             string
	AppPort            string
	LogLevel           string
	DatabaseURL        string
	AppEncryptionKey   string
	SessionSecret      string
	CORSAllowedOrigins []string
	// AI (extraction, PLAN §4.5): OpenAI-compatible structured output.
	// Kosong = parser deterministik lokal (semua hasil masuk review queue).
	AIAPIKey  string
	AIBaseURL string
	AIModel   string
	// AIAPIMode: "chat" (/chat/completions) atau "responses" (/responses).
	// Zen muse-spark* hanya jalan lewat "responses".
	AIAPIMode string
	// OAuth Google (PLAN §2): satu client, dua flow (login + gmail readonly)
	GoogleClientID     string
	GoogleClientSecret string
	GoogleRedirectURL  string
	FrontendURL        string
	// Self-ping anti-sleep Render free: kosong = mati (dev lokal).
	// Di Render isi SELF_PING_URL dgn URL publik service.
	SelfPingURL      string
	SelfPingInterval time.Duration
}

func Load() (*Config, error) {
	_ = godotenv.Load()
	cfg := &Config{
		AppName:            getEnv("APP_NAME", "spendly"),
		AppEnv:             getEnv("APP_ENV", "development"),
		AppPort:            getEnv("APP_PORT", "8080"),
		LogLevel:           getEnv("LOG_LEVEL", "info"),
		DatabaseURL:        getEnv("DATABASE_URL", ""),
		AppEncryptionKey:   getEnv("APP_ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef"),
		SessionSecret:      getEnv("SESSION_SECRET", "dev-session-secret-min-32-chars-xxxx"),
		CORSAllowedOrigins: getCSV("CORS_ALLOWED_ORIGINS", "http://localhost:5173"),
		AIAPIKey:           getEnv("AI_API_KEY", ""),
		AIBaseURL:          getEnv("AI_BASE_URL", "https://api.openai.com/v1"),
		AIModel:            getEnv("AI_MODEL", "gpt-4o-mini"),
		AIAPIMode:          getEnv("AI_API_MODE", "chat"),
		GoogleClientID:     getEnv("GOOGLE_CLIENT_ID", ""),
		GoogleClientSecret: getEnv("GOOGLE_CLIENT_SECRET", ""),
		GoogleRedirectURL:  getEnv("GOOGLE_REDIRECT_URL", "http://localhost:8080/api/v1/auth/google/callback"),
		FrontendURL:        getEnv("FRONTEND_URL", ""),
		SelfPingURL:        getEnv("SELF_PING_URL", os.Getenv("RENDER_EXTERNAL_URL")),
		SelfPingInterval:   getDuration("SELF_PING_INTERVAL", 10*time.Minute),
	}
	if cfg.IsProduction() {
		var problems []string
		if cfg.DatabaseURL == "" {
			problems = append(problems, "DATABASE_URL wajib diisi")
		}
		if len(cfg.AppEncryptionKey) != 16 && len(cfg.AppEncryptionKey) != 24 && len(cfg.AppEncryptionKey) != 32 {
			problems = append(problems, "APP_ENCRYPTION_KEY harus 16/24/32 byte")
		}
		if len(cfg.SessionSecret) < 32 {
			problems = append(problems, "SESSION_SECRET minimal 32 karakter")
		}
		if cfg.GoogleClientID == "" || cfg.GoogleClientSecret == "" {
			problems = append(problems, "GOOGLE_CLIENT_ID/SECRET wajib diisi")
		}
		if len(problems) > 0 {
			return nil, fmt.Errorf("config produksi tidak aman: %s", strings.Join(problems, "; "))
		}
	}
	return cfg, nil
}

func (c *Config) IsProduction() bool {
	return strings.EqualFold(strings.TrimSpace(c.AppEnv), "production")
}

// Metadata build; diisi via -ldflags (lihat Makefile).
var (
	Version   = "dev"
	BuildTime = "unknown"
	GitCommit = "unknown"
)

func GetBuildInfo(env string) map[string]any {
	return map[string]any{
		"version": Version, "build_time": BuildTime,
		"git_commit": GitCommit, "env": env,
	}
}

// OAuthConfigured false bila kredensial Google belum diisi (dev tanpa OAuth).
func (c *Config) OAuthConfigured() bool {
	return c.GoogleClientID != "" && c.GoogleClientSecret != ""
}

// AIConfigured false bila API key AI belum diisi → pakai parser deterministik.
func (c *Config) AIConfigured() bool {
	return c.AIAPIKey != ""
}

func getEnv(k, fb string) string {
	if v, ok := os.LookupEnv(k); ok && v != "" {
		return v
	}
	return fb
}

func getDuration(k string, fb time.Duration) time.Duration {
	if v, ok := os.LookupEnv(k); ok && strings.TrimSpace(v) != "" {
		if d, err := time.ParseDuration(strings.TrimSpace(v)); err == nil && d > 0 {
			return d
		}
	}
	return fb
}

func getCSV(k, fb string) []string {
	raw := getEnv(k, fb)
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var out []string
	for _, p := range strings.Split(raw, ",") {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}
