// Package e2e menguji API end-to-end di atas Postgres nyata (testcontainers):
// auth sesi + CSRF, ledger CRUD, laporan, mailsync, dan SPA fallback.
package e2e

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/semmidev/spendly/internal/app"
	"github.com/semmidev/spendly/internal/modules/ledger"
	"github.com/semmidev/spendly/internal/platform/config"
	"github.com/semmidev/spendly/internal/platform/security"
	"github.com/semmidev/spendly/internal/testutil"
)

type api struct {
	t    *testing.T
	base string
	hc   *http.Client
	jar  *cookiejar.Jar
	pool *pgxpool.Pool
}

func newAPI(t *testing.T) *api {
	t.Helper()
	pool := testutil.StartPostgres(t)
	enc, err := security.NewAESEncryptor("0123456789abcdef0123456789abcdef")
	if err != nil {
		t.Fatalf("enc: %v", err)
	}
	cfg := &config.Config{AppName: "spendly", AppEnv: "test", CORSAllowedOrigins: []string{"http://localhost"}}
	store := ledger.NewStorePG(pool)
	router := app.BuildRouter(cfg, pool, store, enc, nil, nil)
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	jar, _ := cookiejar.New(nil)
	return &api{t: t, base: srv.URL, hc: &http.Client{Jar: jar}, jar: jar, pool: pool}
}

func (a *api) csrf() string {
	u, _ := url.Parse(a.base)
	for _, c := range a.jar.Cookies(u) {
		if c.Name == "csrf_token" {
			return c.Value
		}
	}
	return ""
}

func (a *api) do(method, path string, body any, withCSRF bool) (int, []byte) {
	a.t.Helper()
	var rdr io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, a.base+path, rdr)
	req.Header.Set("Content-Type", "application/json")
	if withCSRF {
		if tok := a.csrf(); tok != "" {
			req.Header.Set("X-CSRF-Token", tok)
		}
	}
	resp, err := a.hc.Do(req)
	if err != nil {
		a.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, data
}

func (a *api) login() {
	a.t.Helper()
	code, _ := a.do("POST", "/api/v1/auth/login", map[string]any{"username": "dev"}, false)
	if code != http.StatusOK {
		a.t.Fatalf("login status %d", code)
	}
}

func TestAuthSessionAndCSRF(t *testing.T) {
	a := newAPI(t)

	// Tanpa sesi → 401.
	if code, _ := a.do("GET", "/api/v1/transactions", nil, false); code != http.StatusUnauthorized {
		t.Fatalf("anon transactions = %d, mau 401", code)
	}

	// Login dev (OAuth belum dikonfigurasi + DB aktif).
	a.login()

	code, body := a.do("GET", "/api/v1/auth/me", nil, false)
	if code != http.StatusOK || !strings.Contains(string(body), "dev@spendly.local") {
		t.Fatalf("me = %d %s", code, body)
	}

	// Mutasi tanpa header CSRF harus ditolak (cookie csrf ada).
	if code, _ := a.do("POST", "/api/v1/transactions", map[string]any{"amount": 1000}, false); code != http.StatusForbidden {
		t.Fatalf("utanpa CSRF = %d, mau 403", code)
	}
}

func TestLedgerAndReports(t *testing.T) {
	a := newAPI(t)
	a.login()

	// Create (dengan CSRF). Tanggal = hari ini agar cek duplikat ±1 hari deterministik.
	today := time.Now().Format("2006-01-02")
	code, body := a.do("POST", "/api/v1/transactions",
		map[string]any{"amount": 125000, "category": "Belanja", "merchant": "GRAB*TRIP 123", "occurred_at": today}, true)
	if code != http.StatusCreated {
		t.Fatalf("create = %d %s", code, body)
	}
	if !strings.Contains(string(body), `"merchant":"Grab"`) {
		t.Fatalf("normalisasi merchant gagal: %s", body)
	}

	// List + filter.
	code, body = a.do("GET", "/api/v1/transactions?category=Belanja", nil, false)
	if code != http.StatusOK || !strings.Contains(string(body), `"total":1`) {
		t.Fatalf("list = %d %s", code, body)
	}

	// Deteksi duplikat manual (nominal sama ±1 hari) → hint.
	code, body = a.do("POST", "/api/v1/transactions",
		map[string]any{"amount": 125000, "category": "Belanja", "merchant": "Grab"}, true)
	if code != http.StatusCreated || !strings.Contains(string(body), "possible_duplicate_of") {
		t.Fatalf("dup hint = %d %s", code, body)
	}

	// Laporan.
	code, body = a.do("GET", "/api/v1/dashboard/summary", nil, false)
	if code != http.StatusOK || !strings.Contains(string(body), `"total_month":250000`) {
		t.Fatalf("summary = %d %s", code, body)
	}

	// CSV.
	code, body = a.do("GET", "/api/v1/export.csv", nil, false)
	if code != http.StatusOK || !strings.HasPrefix(string(body), "id,amount,currency") {
		t.Fatalf("csv = %d %s", code, body)
	}

	// Get id lalu delete + restore.
	var listResp struct {
		Data struct {
			Items []struct {
				ID string `json:"id"`
			} `json:"items"`
		} `json:"data"`
	}
	_, lb := a.do("GET", "/api/v1/transactions", nil, false)
	_ = json.Unmarshal(lb, &listResp)
	if len(listResp.Data.Items) == 0 {
		t.Fatal("tidak ada transaksi untuk delete")
	}
	id := listResp.Data.Items[0].ID

	if code, _ := a.do("DELETE", "/api/v1/transactions/"+id, nil, true); code != http.StatusOK {
		t.Fatalf("delete = %d", code)
	}
	if code, _ := a.do("POST", "/api/v1/transactions/"+id+"/restore", nil, true); code != http.StatusOK {
		t.Fatalf("restore = %d", code)
	}
}

func TestMailsyncAndVersion(t *testing.T) {
	a := newAPI(t)
	a.login()

	code, body := a.do("GET", "/api/v1/senders/recommended", nil, false)
	if code != http.StatusOK || !strings.Contains(string(body), "bca.co.id") {
		t.Fatalf("recommended = %d %s", code, body)
	}

	// Sync tanpa koneksi → validasi gagal.
	if code, _ := a.do("POST", "/api/v1/gmail/sync", map[string]any{}, true); code != http.StatusBadRequest {
		t.Fatalf("sync tanpa koneksi = %d, mau 400", code)
	}

	// Koneksi kosong (belum hubungkan Gmail).
	if code, body := a.do("GET", "/api/v1/gmail/connections", nil, false); code != http.StatusOK || !strings.Contains(string(body), `"items":[]`) {
		t.Fatalf("connections = %d %s", code, body)
	}

	// Kontrol scan: scan_limit di luar rentang → 400.
	if code, _ := a.do("PATCH", "/api/v1/gmail/connections/00000000-0000-0000-0000-000000000000",
		map[string]any{"scan_window": "7d", "scan_limit": 0}, true); code != http.StatusBadRequest {
		t.Fatalf("scan_limit invalid = %d, mau 400", code)
	}
	// Job aktif tanpa koneksi → 404.
	if code, _ := a.do("GET", "/api/v1/gmail/sync/active", nil, false); code != http.StatusNotFound {
		t.Fatalf("sync active tanpa koneksi = %d, mau 404", code)
	}
	// scan_window tak dikenal → 400.
	if code, _ := a.do("PATCH", "/api/v1/gmail/connections/00000000-0000-0000-0000-000000000000",
		map[string]any{"scan_window": "xyz", "scan_limit": 50}, true); code != http.StatusBadRequest {
		t.Fatalf("scan_window invalid = %d, mau 400", code)
	}

	if code, _ := a.do("GET", "/version", nil, false); code != http.StatusOK {
		t.Fatalf("version = %d", code)
	}
}

// TestSenderRegistry: tambah manual (is_seed=false), duplikat/seed ditolak,
// hanya pembuat yang bisa menghapus.
func TestSenderRegistry(t *testing.T) {
	a := newAPI(t)
	a.login()

	code, body := a.do("POST", "/api/v1/senders/registry",
		map[string]any{"domain": "ManualBank.co.id", "label": "Manual Bank"}, true)
	if code != http.StatusCreated {
		t.Fatalf("tambah registry = %d %s", code, body)
	}
	var resp struct {
		Data struct {
			ID     string `json:"id"`
			Domain string `json:"domain"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil || resp.Data.ID == "" {
		t.Fatalf("parse registry: %v %s", err, body)
	}
	if resp.Data.Domain != "manualbank.co.id" {
		t.Fatalf("domain tidak dinormalisasi: %q", resp.Data.Domain)
	}

	// Domain sama milik sendiri → update label, tetap 201.
	if code, _ := a.do("POST", "/api/v1/senders/registry",
		map[string]any{"domain": "manualbank.co.id", "label": "Manual Bank 2"}, true); code != http.StatusCreated {
		t.Fatalf("update registry = %d", code)
	}

	// Domain seed → ditolak.
	if code, _ := a.do("POST", "/api/v1/senders/registry",
		map[string]any{"domain": "bca.co.id", "label": "X"}, true); code != http.StatusConflict {
		t.Fatalf("tambah seed domain = %d, mau 409", code)
	}

	// Seed tidak bisa dihapus.
	var seedID string
	if err := a.pool.QueryRow(context.Background(),
		`SELECT id::text FROM sender_registry WHERE is_seed LIMIT 1`).Scan(&seedID); err != nil {
		t.Fatalf("seed id: %v", err)
	}
	if code, _ := a.do("DELETE", "/api/v1/senders/registry/"+seedID, nil, true); code != http.StatusNotFound {
		t.Fatalf("hapus seed = %d, mau 404", code)
	}

	// Pembuat bisa hapus, lalu 404 saat diulang.
	if code, _ := a.do("DELETE", "/api/v1/senders/registry/"+resp.Data.ID, nil, true); code != http.StatusOK {
		t.Fatalf("hapus manual = %d", code)
	}
	if code, _ := a.do("DELETE", "/api/v1/senders/registry/"+resp.Data.ID, nil, true); code != http.StatusNotFound {
		t.Fatalf("hapus ulang = %d, mau 404", code)
	}
}

// TestScanCustomRange: PATCH scan_window=custom dengan rentang tanggal eksplisit.
func TestScanCustomRange(t *testing.T) {
	a := newAPI(t)
	a.login()
	ctx := context.Background()

	_, me := a.do("GET", "/api/v1/auth/me", nil, false)
	var meResp struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(me, &meResp); err != nil || meResp.Data.ID == "" {
		t.Fatalf("me parse: %v %s", err, me)
	}
	var connID string
	if err := a.pool.QueryRow(ctx, `INSERT INTO gmail_connections (user_id, google_email, enc_refresh_token, status)
		VALUES ($1,'custom@gmail.com','x','active') RETURNING id::text`, meResp.Data.ID).Scan(&connID); err != nil {
		t.Fatalf("insert conn: %v", err)
	}

	// Valid custom range → 200, tersimpan.
	if code, body := a.do("PATCH", "/api/v1/gmail/connections/"+connID,
		map[string]any{"scan_window": "custom", "scan_limit": 50, "scan_from": "2026-01-01", "scan_to": "2026-01-31"}, true); code != http.StatusOK {
		t.Fatalf("patch custom = %d %s", code, body)
	}
	_, st := a.do("GET", "/api/v1/sync/status?connection_id="+connID, nil, false)
	if !strings.Contains(string(st), `"scan_window":"custom"`) ||
		!strings.Contains(string(st), `"scan_from":"2026-01-01"`) ||
		!strings.Contains(string(st), `"scan_to":"2026-01-31"`) {
		t.Fatalf("status custom = %s", st)
	}

	// from > to → 400.
	if code, _ := a.do("PATCH", "/api/v1/gmail/connections/"+connID,
		map[string]any{"scan_window": "custom", "scan_limit": 50, "scan_from": "2026-02-01", "scan_to": "2026-01-01"}, true); code != http.StatusBadRequest {
		t.Fatalf("custom from>to = %d, mau 400", code)
	}
	// tanggal hilang → 400.
	if code, _ := a.do("PATCH", "/api/v1/gmail/connections/"+connID,
		map[string]any{"scan_window": "custom", "scan_limit": 50}, true); code != http.StatusBadRequest {
		t.Fatalf("custom tanpa tanggal = %d, mau 400", code)
	}
}

func TestHealth(t *testing.T) {
	a := newAPI(t)
	if code, _ := a.do("GET", "/health/live", nil, false); code != http.StatusOK {
		t.Fatalf("live = %d", code)
	}
	if code, _ := a.do("GET", "/health/ready", nil, false); code != http.StatusOK {
		t.Fatalf("ready = %d", code)
	}
}

// Regresi: redirect Gmail menunjuk ke /auth/google/callback/gmail; route ini
// harus terdaftar (401 karena tanpa sesi), bukan 404.
func TestGmailCallbackRouteRegistered(t *testing.T) {
	a := newAPI(t)
	code, _ := a.do("GET", "/api/v1/auth/google/callback/gmail?state=x&code=y", nil, false)
	if code == http.StatusNotFound {
		t.Fatal("route gmail callback tidak terdaftar (404)")
	}
	if code != http.StatusUnauthorized {
		t.Fatalf("gmail callback tanpa sesi = %d, mau 401", code)
	}
}

// Regresi: export CSV tidak boleh terpotong oleh cap paginasi 100.
func TestExportCSVNotTruncated(t *testing.T) {
	a := newAPI(t)
	a.login()
	const n = 105
	for i := 0; i < n; i++ {
		code, body := a.do("POST", "/api/v1/transactions",
			map[string]any{"amount": 1000 + i, "category": "Lainnya", "merchant": "M"}, true)
		if code != http.StatusCreated {
			t.Fatalf("create ke-%d = %d %s", i, code, body)
		}
	}
	code, body := a.do("GET", "/api/v1/export.csv", nil, false)
	if code != http.StatusOK {
		t.Fatalf("csv = %d", code)
	}
	lines := strings.Count(string(body), "\n")
	if lines < n {
		t.Fatalf("CSV hanya %d baris, mau >= %d (terpotong)", lines, n)
	}
}

// TestSyncJobLifecycle: validasi scan, simpan pengaturan, dan job async.
func TestSyncJobLifecycle(t *testing.T) {
	a := newAPI(t)
	a.login()
	ctx := context.Background()

	_, me := a.do("GET", "/api/v1/auth/me", nil, false)
	var meResp struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(me, &meResp); err != nil || meResp.Data.ID == "" {
		t.Fatalf("me parse: %v %s", err, me)
	}
	uid := meResp.Data.ID

	var connID string
	if err := a.pool.QueryRow(ctx, `INSERT INTO gmail_connections (user_id, google_email, enc_refresh_token, status)
		VALUES ($1,'e2e@gmail.com','x','active') RETURNING id::text`, uid).Scan(&connID); err != nil {
		t.Fatalf("insert conn: %v", err)
	}

	// Tanpa pengirim diizinkan → 400.
	if code, body := a.do("POST", "/api/v1/gmail/sync", map[string]any{"connection_id": connID}, true); code != http.StatusBadRequest {
		t.Fatalf("sync tanpa sender = %d %s", code, body)
	}

	// Simpan scan_window=month, lalu pastikan tersimpan.
	if code, body := a.do("PATCH", "/api/v1/gmail/connections/"+connID,
		map[string]any{"scan_window": "month", "scan_limit": 50}, true); code != http.StatusOK {
		t.Fatalf("patch settings = %d %s", code, body)
	}
	_, st := a.do("GET", "/api/v1/sync/status?connection_id="+connID, nil, false)
	if !strings.Contains(string(st), `"scan_window":"month"`) {
		t.Fatalf("status scan_window = %s", st)
	}

	// Izinkan satu pengirim, mulai job.
	if _, err := a.pool.Exec(ctx, `INSERT INTO user_senders (connection_id, sender_domain, allowed)
		VALUES ($1::uuid,'bca.co.id',true)`, connID); err != nil {
		t.Fatalf("insert sender: %v", err)
	}
	code, body := a.do("POST", "/api/v1/gmail/sync", map[string]any{"connection_id": connID, "max_emails": 5}, true)
	if code != http.StatusAccepted || !strings.Contains(string(body), "job_id") {
		t.Fatalf("start sync = %d %s", code, body)
	}
	var startResp struct {
		Data struct {
			JobID string `json:"job_id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(body, &startResp)
	if startResp.Data.JobID == "" {
		t.Fatal("job_id kosong")
	}

	if code, jb := a.do("GET", "/api/v1/gmail/sync/"+startResp.Data.JobID, nil, false); code != http.StatusOK || !strings.Contains(string(jb), "progress") {
		t.Fatalf("job status = %d %s", code, jb)
	}
}
