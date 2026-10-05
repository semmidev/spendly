package identity

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"

	"github.com/semmidev/spendly/internal/platform/apperr"
	"github.com/semmidev/spendly/internal/platform/audit"
	"github.com/semmidev/spendly/internal/platform/config"
	"github.com/semmidev/spendly/internal/platform/middleware"
	"github.com/semmidev/spendly/internal/platform/security"
	"github.com/semmidev/spendly/internal/platform/web"
)

// Handler: login Google (openid email profile) + hubung Gmail incremental.
// Satu client OAuth, dua flow (PLAN §2.1). Tanpa GOOGLE_CLIENT_ID → stub dev.
type Handler struct {
	cfg       *config.Config
	pool      *pgxpool.Pool
	encryptor *security.AESEncryptor
	verifier  *oidc.IDTokenVerifier
	loginCfg  *oauth2.Config
	gmailCfg  *oauth2.Config
}

func NewHandler(cfg *config.Config, pool *pgxpool.Pool, enc *security.AESEncryptor) *Handler {
	h := &Handler{cfg: cfg, pool: pool, encryptor: enc}
	if cfg.OAuthConfigured() {
		ctx := context.Background()
		provider, err := oidc.NewProvider(ctx, "https://accounts.google.com")
		if err == nil {
			h.verifier = provider.Verifier(&oidc.Config{ClientID: cfg.GoogleClientID})
		}
		h.loginCfg = &oauth2.Config{
			ClientID: cfg.GoogleClientID, ClientSecret: cfg.GoogleClientSecret,
			RedirectURL: cfg.GoogleRedirectURL,
			Scopes:      []string{oidc.ScopeOpenID, "email", "profile"},
			Endpoint:    google.Endpoint,
		}
		h.gmailCfg = &oauth2.Config{
			ClientID: cfg.GoogleClientID, ClientSecret: cfg.GoogleClientSecret,
			RedirectURL: cfg.GoogleRedirectURL + "/gmail",
			Scopes:      []string{oidc.ScopeOpenID, "email", "profile", "https://www.googleapis.com/auth/gmail.readonly"},
			Endpoint:    google.Endpoint,
		}
	}
	return h
}

func (h *Handler) Mount(r chi.Router) {
	r.Get("/auth/google/login", h.googleLogin)
	r.Get("/auth/google/callback", h.googleCallback)
	r.Post("/auth/login", h.devLogin) // dev tanpa OAuth saja
	r.Post("/auth/logout", h.logout)
	r.Post("/auth/refresh", h.refreshStub)

	r.Group(func(r chi.Router) {
		r.Use(middleware.Session(h.pool))
		r.Get("/auth/me", h.me)
		r.Delete("/users/me", h.deleteAccount)
		r.Get("/gmail/connect", h.gmailConnect)
		// Redirect Gmail = GOOGLE_REDIRECT_URL + "/gmail".
		r.Get("/auth/google/callback/gmail", h.gmailCallback)
		r.Get("/gmail/callback", h.gmailCallback) // alias lama
		r.Get("/gmail/connections", h.listConnections)
		r.Delete("/gmail/connections/{id}", h.deleteConnection)
	})
}

// ---- login ----

func (h *Handler) googleLogin(w http.ResponseWriter, r *http.Request) {
	if !h.cfg.OAuthConfigured() || h.loginCfg == nil {
		http.Error(w, "OAuth Google belum dikonfigurasi (isi GOOGLE_CLIENT_ID/SECRET)", http.StatusNotImplemented)
		return
	}
	verifier := oauth2.GenerateVerifier()
	state := middleware.RandomToken(16)
	setCookie(w, "oauth_state", state, 10*time.Minute, true, h.cfg.IsProduction())
	setCookie(w, "oauth_verifier", verifier, 10*time.Minute, true, h.cfg.IsProduction())
	http.Redirect(w, r, h.loginCfg.AuthCodeURL(state, oauth2.AccessTypeOnline, oauth2.SetAuthURLParam("code_challenge", challenge(verifier)), oauth2.SetAuthURLParam("code_challenge_method", "S256")), http.StatusFound)
}

// oauthPrereq memeriksa prasyarat login Google dan mengembalikan pesan bila gagal.
func (h *Handler) oauthPrereq() string {
	if !h.cfg.OAuthConfigured() {
		return "OAuth Google belum dikonfigurasi: isi GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET di .env"
	}
	if h.loginCfg == nil {
		return "konfigurasi OIDC Google gagal dimuat saat start (cek koneksi ke accounts.google.com)"
	}
	return ""
}

func (h *Handler) googleCallback(w http.ResponseWriter, r *http.Request) {
	if msg := h.oauthPrereq(); msg != "" {
		http.Error(w, msg, http.StatusNotImplemented)
		return
	}
	if !checkState(r) {
		http.Error(w, "state tidak valid", http.StatusBadRequest)
		return
	}
	verifier := cookieVal(r, "oauth_verifier")
	tok, err := h.loginCfg.Exchange(r.Context(), r.URL.Query().Get("code"), oauth2.VerifierOption(verifier))
	if err != nil {
		http.Error(w, "gagal tukar kode: "+err.Error(), http.StatusBadGateway)
		return
	}
	sub, email, name, err := h.verifyIDToken(r.Context(), tok)
	if err != nil {
		http.Error(w, "token tidak valid: "+err.Error(), http.StatusUnauthorized)
		return
	}
	uid, err := h.upsertUser(r.Context(), sub, email, name)
	if err != nil {
		http.Error(w, "gagal simpan user", http.StatusInternalServerError)
		return
	}
	h.issueSession(w, r, uid)
	audit.Record(r.Context(), h.pool, uid, "auth.login", "google", nil)
	clearCookie(w, "oauth_state")
	clearCookie(w, "oauth_verifier")
	http.Redirect(w, r, h.appURL("/beranda"), http.StatusFound)
}

func (h *Handler) verifyIDToken(ctx context.Context, tok *oauth2.Token) (sub, email, name string, err error) {
	raw, ok := tok.Extra("id_token").(string)
	if !ok || raw == "" || h.verifier == nil {
		return "", "", "", errInvalid("id_token kosong")
	}
	t, err := h.verifier.Verify(ctx, raw)
	if err != nil {
		return "", "", "", err
	}
	var claims struct {
		Email string `json:"email"`
		Name  string `json:"name"`
	}
	_ = t.Claims(&claims)
	return t.Subject, claims.Email, claims.Name, nil
}

func (h *Handler) upsertUser(ctx context.Context, sub, email, name string) (string, error) {
	if name == "" {
		name = email
	}
	var id string
	err := h.pool.QueryRow(ctx, `INSERT INTO users (google_sub, email, name)
		VALUES ($1,$2,$3) ON CONFLICT (google_sub) DO UPDATE SET email=EXCLUDED.email, name=EXCLUDED.name
		RETURNING id::text`, sub, email, name).Scan(&id)
	if err != nil {
		return "", err
	}
	_, _ = h.pool.Exec(ctx, `INSERT INTO categories (user_id, name)
		SELECT $1, u.n FROM (VALUES ('Makanan'),('Transport'),('Belanja'),('Tagihan'),('Hiburan'),('Kesehatan'),('Transfer'),('Lainnya')) u(n)
		ON CONFLICT DO NOTHING`, id)
	return id, nil
}

func (h *Handler) issueSession(w http.ResponseWriter, r *http.Request, uid string) {
	sid, _ := uuid.NewV7()
	_, _ = h.pool.Exec(r.Context(), `INSERT INTO sessions (id, user_id, expires_at)
		VALUES ($1::uuid,$2,now()+interval '30 days')`, sid.String(), uid)
	setCookie(w, middleware.SessionCookie, sid.String(), 30*24*time.Hour, true, h.cfg.IsProduction())
	setCookie(w, middleware.CSRFCookie, middleware.RandomToken(16), 30*24*time.Hour, false, h.cfg.IsProduction())
}

// ---- gmail incremental (PLAN §2.1) ----

func (h *Handler) gmailConnect(w http.ResponseWriter, r *http.Request) {
	if !h.cfg.OAuthConfigured() || h.gmailCfg == nil {
		web.Error(w, r, apperr.Invalid("OAuth Google belum dikonfigurasi"))
		return
	}
	verifier := oauth2.GenerateVerifier()
	state := middleware.RandomToken(16)
	setCookie(w, "gmail_state", state, 10*time.Minute, true, h.cfg.IsProduction())
	setCookie(w, "gmail_verifier", verifier, 10*time.Minute, true, h.cfg.IsProduction())
	http.Redirect(w, r, h.gmailCfg.AuthCodeURL(state,
		oauth2.AccessTypeOffline, oauth2.ApprovalForce,
		oauth2.SetAuthURLParam("include_granted_scopes", "true"),
		oauth2.SetAuthURLParam("prompt", "consent"),
		oauth2.SetAuthURLParam("code_challenge", challenge(verifier)),
		oauth2.SetAuthURLParam("code_challenge_method", "S256")), http.StatusFound)
}

func (h *Handler) gmailCallback(w http.ResponseWriter, r *http.Request) {
	uid, _ := web.UserID(r.Context())
	if h.gmailCfg == nil {
		http.Error(w, "OAuth Gmail belum dikonfigurasi (isi GOOGLE_CLIENT_ID/SECRET)", http.StatusNotImplemented)
		return
	}
	st, _ := r.Cookie("gmail_state")
	if st == nil || st.Value == "" || st.Value != r.URL.Query().Get("state") {
		http.Error(w, "state tidak valid", http.StatusBadRequest)
		return
	}
	verifier := cookieVal(r, "gmail_verifier")
	tok, err := h.gmailCfg.Exchange(r.Context(), r.URL.Query().Get("code"), oauth2.VerifierOption(verifier))
	if err != nil {
		http.Error(w, "gagal tukar kode Gmail: "+err.Error(), http.StatusBadGateway)
		return
	}
	if tok.RefreshToken == "" {
		http.Error(w, "Google tidak memberi refresh token (coba putus dulu di myaccount.google.com/permissions)", http.StatusBadGateway)
		return
	}
	enc, err := h.encryptor.Encrypt(tok.RefreshToken)
	if err != nil {
		http.Error(w, "gagal enkripsi token", http.StatusInternalServerError)
		return
	}
	email := ""
	if _, e, _, verr := h.verifyIDToken(r.Context(), tok); verr == nil {
		email = e
	}
	// Atomic upsert: buat baru atau perbarui token bila koneksi sudah ada.
	_, err = h.pool.Exec(r.Context(), `INSERT INTO gmail_connections (user_id, google_email, enc_refresh_token, status, backfill_days)
		VALUES ($1,$2,$3,'active',30)
		ON CONFLICT (user_id, google_email) DO UPDATE
		  SET enc_refresh_token=EXCLUDED.enc_refresh_token, status='active', updated_at=now()`, uid, email, enc)
	if err != nil {
		http.Error(w, "gagal menyimpan koneksi Gmail", http.StatusInternalServerError)
		return
	}
	audit.Record(r.Context(), h.pool, uid, "gmail.connect", email, nil)
	clearCookie(w, "gmail_state")
	clearCookie(w, "gmail_verifier")
	http.Redirect(w, r, h.appURL("/akun?gmail=connected"), http.StatusFound)
}

func (h *Handler) listConnections(w http.ResponseWriter, r *http.Request) {
	uid, _ := web.UserID(r.Context())
	rows, err := h.pool.Query(r.Context(), `SELECT id::text, google_email, status, last_synced_at, backfill_days
		FROM gmail_connections WHERE user_id=$1 ORDER BY last_synced_at DESC NULLS LAST`, uid)
	if err != nil {
		web.Error(w, r, err)
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, email, status string
		var synced, backfill any
		if err := rows.Scan(&id, &email, &status, &synced, &backfill); err == nil {
			items = append(items, map[string]any{"id": id, "google_email": email, "status": status, "last_synced_at": synced, "backfill_days": backfill})
		}
	}
	web.Success(w, http.StatusOK, "Koneksi Gmail", map[string]any{"items": items}, nil)
}

func (h *Handler) deleteConnection(w http.ResponseWriter, r *http.Request) {
	uid, _ := web.UserID(r.Context())
	id := chi.URLParam(r, "id")
	if id == "primary" {
		// FE lama kirim "primary" — artikan koneksi pertama user
		_ = h.pool.QueryRow(r.Context(), `SELECT id::text FROM gmail_connections WHERE user_id=$1 LIMIT 1`, uid).Scan(&id)
	}
	if id != "" && id != "primary" {
		var enc string
		_ = h.pool.QueryRow(r.Context(), `SELECT enc_refresh_token FROM gmail_connections WHERE id=$1::uuid AND user_id=$2`, id, uid).Scan(&enc)
		if enc != "" && h.encryptor != nil {
			if raw, err := h.encryptor.Decrypt(enc); err == nil {
				revokeToken(r.Context(), raw)
			}
		}
		_, _ = h.pool.Exec(r.Context(), `DELETE FROM gmail_connections WHERE id=$1::uuid AND user_id=$2`, id, uid)
		audit.Record(r.Context(), h.pool, uid, "gmail.disconnect", id, nil)
	}
	web.Success(w, http.StatusOK, "Gmail diputus", nil, nil)
}

func revokeToken(ctx context.Context, refreshToken string) {
	req, _ := http.NewRequestWithContext(ctx, "POST", "https://oauth2.googleapis.com/revoke?token="+refreshToken, nil)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := http.DefaultClient.Do(req)
	if err == nil {
		resp.Body.Close()
	}
}

// ---- me / logout / delete ----

func (h *Handler) me(w http.ResponseWriter, r *http.Request) {
	uid, _ := web.UserID(r.Context())
	var name, email, id string
	if err := h.pool.QueryRow(r.Context(), `SELECT id::text, name, email FROM users WHERE id=$1::uuid`, uid).Scan(&id, &name, &email); err != nil {
		web.Error(w, r, apperr.Unauthorized("sesi tidak valid"))
		return
	}
	web.Success(w, http.StatusOK, "Profil", map[string]any{"id": id, "name": name, "email": email}, nil)
}

func (h *Handler) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(middleware.SessionCookie); err == nil {
		_, _ = h.pool.Exec(r.Context(), `DELETE FROM sessions WHERE id=$1::uuid`, c.Value)
	}
	clearCookie(w, middleware.SessionCookie)
	web.Success(w, http.StatusOK, "Logout berhasil", nil, nil)
}

func (h *Handler) refreshStub(w http.ResponseWriter, r *http.Request) {
	web.Success(w, http.StatusOK, "OK", nil, nil)
}

// devLogin: hanya bila OAuth belum dikonfigurasi (pengembangan lokal).
func (h *Handler) devLogin(w http.ResponseWriter, r *http.Request) {
	if h.cfg.OAuthConfigured() {
		web.Error(w, r, apperr.Invalid("gunakan login Google"))
		return
	}
	var id string
	err := h.pool.QueryRow(r.Context(), `INSERT INTO users (google_sub, email, name)
		VALUES ('dev','dev@spendly.local','Pengguna Spendly')
		ON CONFLICT (google_sub) DO UPDATE SET email=EXCLUDED.email
		RETURNING id::text`).Scan(&id)
	if err != nil {
		web.Error(w, r, apperr.Internal("gagal siapkan user dev", err))
		return
	}
	h.issueSession(w, r, id)
	web.Success(w, http.StatusOK, "Login berhasil",
		map[string]any{"user": map[string]any{"id": id, "name": "Pengguna Spendly", "email": "dev@spendly.local"}}, nil)
}

func (h *Handler) deleteAccount(w http.ResponseWriter, r *http.Request) {
	uid, _ := web.UserID(r.Context())
	if uid != "" {
		audit.Record(r.Context(), h.pool, uid, "account.delete", uid, nil)
		_, _ = h.pool.Exec(r.Context(), `DELETE FROM users WHERE id=$1::uuid`, uid)
	}
	clearCookie(w, middleware.SessionCookie)
	web.Success(w, http.StatusOK, "Akun dihapus", nil, nil)
}

// ---- cookies & PKCE ----

func setCookie(w http.ResponseWriter, name, val string, maxAge time.Duration, httpOnly, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name: name, Value: val, Path: "/", MaxAge: int(maxAge.Seconds()),
		HttpOnly: httpOnly, Secure: secure, SameSite: http.SameSiteLaxMode,
	})
}

func clearCookie(w http.ResponseWriter, name string) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: "", Path: "/", MaxAge: -1})
}

func cookieVal(r *http.Request, name string) string {
	c, err := r.Cookie(name)
	if err != nil {
		return ""
	}
	return c.Value
}

func checkState(r *http.Request) bool {
	st, err := r.Cookie("oauth_state")
	if err != nil || st.Value == "" {
		return false
	}
	return st.Value == r.URL.Query().Get("state")
}

func challenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func errInvalid(msg string) error { return apperr.Invalid(msg) }

// appURL membangun URL redirect. Kosong → relatif (SPA satu origin).
func (h *Handler) appURL(path string) string {
	base := strings.TrimRight(h.cfg.FrontendURL, "/")
	return base + path
}
