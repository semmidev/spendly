package mailsync

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	gmailapi "google.golang.org/api/gmail/v1"

	"github.com/semmidev/spendly/internal/platform/apperr"
	"github.com/semmidev/spendly/internal/platform/config"
	"github.com/semmidev/spendly/internal/platform/security"
	gmailp "github.com/semmidev/spendly/internal/provider/gmail"
)

// Extractor dipasang modul extraction (menghindari import cycle).
// ProcessRaw: extract → parse → validate → dedup → ledger / review / ignored.
type Extractor interface {
	ProcessRaw(ctx context.Context, rawID string) error
}

type Service struct {
	pool *pgxpool.Pool
	cfg  *config.Config
	enc  *security.AESEncryptor

	Extract Extractor
	// seam uji: ganti konstruksi klien Gmail
	newClient func(ctx context.Context, refreshToken string) (gmailClient, error)
	jobs      *jobManager
}

// gmailClient: subset Gmail API yang dipakai sync (mudah di-stub saat test).
type gmailClient interface {
	ListIDs(ctx context.Context, query, pageToken string) (ids []string, next string, err error)
	Get(ctx context.Context, id string) (*gmailapi.Message, error)
	GetMetadata(ctx context.Context, id string) (*gmailapi.Message, error)
	HistoryIDNow(ctx context.Context) (uint64, error)
	HistoryAdded(ctx context.Context, historyID uint64) (ids []string, newHistoryID uint64, expired bool, err error)
}

func NewService(pool *pgxpool.Pool, cfg *config.Config, enc *security.AESEncryptor) *Service {
	s := &Service{pool: pool, cfg: cfg, enc: enc, jobs: newJobManager()}
	s.newClient = func(ctx context.Context, rt string) (gmailClient, error) {
		return gmailp.New(ctx, cfg.GoogleClientID, cfg.GoogleClientSecret, rt)
	}
	return s
}

type Stats struct {
	Listed       int `json:"listed"`
	New          int `json:"new"`
	Gated        int `json:"gated"`
	Extracted    int `json:"extracted"`
	Limit        int `json:"limit"`
	BackfillDays int `json:"backfill_days"`
}

// AllowedDomains: sender yang user izinkan untuk koneksi ini.
func (s *Service) AllowedDomains(ctx context.Context, connectionID string) []string {
	rows, err := s.pool.Query(ctx, `SELECT sender_domain FROM user_senders WHERE connection_id=$1::uuid AND allowed`, connectionID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var d string
		if err := rows.Scan(&d); err == nil {
			out = append(out, d)
		}
	}
	return out
}

func buildQuery(domains []string, after, before time.Time) string {
	var ors []string
	for _, d := range domains {
		ors = append(ors, strings.TrimSpace(d))
	}
	q := fmt.Sprintf("from:(%s) after:%d", strings.Join(ors, " OR "), after.Unix())
	if !before.IsZero() {
		q += fmt.Sprintf(" before:%d", before.Unix())
	}
	return q
}

func senderDomain(from string) string {
	// "Nama <a@bca.co.id>" → bca.co.id
	if i := strings.LastIndex(from, "@"); i >= 0 {
		rest := from[i+1:]
		if j := strings.IndexAny(rest, " >\"',;)"); j >= 0 {
			rest = rest[:j]
		}
		return strings.ToLower(strings.TrimSpace(rest))
	}
	return strings.ToLower(strings.TrimSpace(from))
}

// firstConnection: koneksi aktif pertama user (untuk default FE).
func (s *Service) firstConnection(ctx context.Context, uid string) string {
	if uid == "" || uid == "dev" {
		return ""
	}
	var id string
	_ = s.pool.QueryRow(ctx, `SELECT id::text FROM gmail_connections
		WHERE user_id=$1 AND status='active' LIMIT 1`, uid).Scan(&id)
	return id
}

// SetAllowed: ganti daftar sender yang boleh dibaca (hanya milik user).
func (s *Service) SetAllowed(ctx context.Context, uid, connectionID string, domains []string) error {
	var owner string
	err := s.pool.QueryRow(ctx, `SELECT user_id::text FROM gmail_connections WHERE id=$1::uuid`, connectionID).Scan(&owner)
	if err != nil || owner != uid {
		return apperr.NotFound("koneksi Gmail tidak ditemukan")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `UPDATE user_senders SET allowed=false WHERE connection_id=$1::uuid`, connectionID); err != nil {
		return err
	}
	for _, d := range domains {
		d = strings.ToLower(strings.TrimSpace(d))
		if d == "" {
			continue
		}
		if _, err := tx.Exec(ctx, `INSERT INTO user_senders (connection_id, sender_domain, allowed)
			VALUES ($1::uuid,$2,true)
			ON CONFLICT (connection_id, sender_domain) DO UPDATE SET allowed=true`, connectionID, d); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// windowDays: pilihan jendela → jumlah hari. "month" = sejak tanggal 1.
func windowDays(window string) int {
	switch window {
	case "1d":
		return 1
	case "7d":
		return 7
	case "month":
		return time.Now().Day()
	case "90d":
		return 90
	case "custom":
		return 0 // rentang eksplisit scan_from/scan_to
	default:
		return 30
	}
}

func validWindow(w string) bool {
	switch w {
	case "1d", "7d", "month", "30d", "90d", "custom":
		return true
	}
	return false
}

// Progress: status satu job sinkronisasi (dipakai SSE + polling).
type Progress struct {
	Status    string `json:"status"`
	Mode      string `json:"mode"`
	Processed int    `json:"processed"`
	Total     int    `json:"total"`
	New       int    `json:"new"`
	Gated     int    `json:"gated"`
	Extracted int    `json:"extracted"`
	Current   string `json:"current"`
	Message   string `json:"message"`
}

// runSync menjalankan scan. gate() dipanggil sebelum tiap email (pause/cancel);
// report() melaporkan progres. Tiap email disimpan dengan satu statement
// idempoten sehingga tidak ada transaksi panjang yang ditahan.
func (s *Service) runSync(ctx context.Context, uid, connectionID string, forceDays, maxEmails int, gate func() error, report func(Progress)) (Stats, error) {
	var st Stats
	var encTok, historyID, window string
	var scanLimit int
	var scanFrom, scanTo *time.Time
	err := s.pool.QueryRow(ctx, `SELECT enc_refresh_token, COALESCE(history_id,''), scan_window, scan_limit, scan_from, scan_to
		FROM gmail_connections WHERE id=$1::uuid AND user_id=$2 AND status='active'`,
		connectionID, uid).Scan(&encTok, &historyID, &window, &scanLimit, &scanFrom, &scanTo)
	if err != nil {
		return st, apperr.NotFound("koneksi Gmail tidak ditemukan / tidak aktif")
	}
	allowed := map[string]bool{}
	for _, d := range s.AllowedDomains(ctx, connectionID) {
		allowed[strings.ToLower(d)] = true
	}
	if len(allowed) == 0 {
		return st, apperr.Invalid("belum ada pengirim yang diizinkan — pilih dulu di Pengaturan Gmail")
	}
	rt, err := s.enc.Decrypt(encTok)
	if err != nil {
		return st, err
	}
	client, err := s.newClient(ctx, rt)
	if err != nil {
		return st, err
	}

	limit := scanLimit
	if maxEmails > 0 {
		limit = maxEmails
	}

	var after, before time.Time
	days := windowDays(window)
	mode := "incremental"
	switch {
	case window == "custom" && scanFrom != nil && scanTo != nil:
		// Rentang eksplisit; `before` eksklusif di Gmail → +1 hari agar `scan_to` ikut.
		after = time.Date(scanFrom.Year(), scanFrom.Month(), scanFrom.Day(), 0, 0, 0, 0, time.Local)
		before = time.Date(scanTo.Year(), scanTo.Month(), scanTo.Day(), 0, 0, 0, 0, time.Local).AddDate(0, 0, 1)
		days = int(before.Sub(after).Hours() / 24)
		mode = "backfill"
	case forceDays > 0:
		after = time.Now().AddDate(0, 0, -forceDays)
		mode = "backfill"
	default:
		if days <= 0 {
			days = 30
		}
		after = time.Now().AddDate(0, 0, -days)
		if historyID == "" {
			mode = "backfill"
		}
	}
	st.Limit, st.BackfillDays = limit, days

	slog.Info("sync mulai", "conn", shortID(connectionID), "mode", mode, "days", days, "limit", limit, "senders", len(allowed))
	report(Progress{Status: "running", Mode: mode, Total: limit, Message: "menyiapkan"})

	if mode == "backfill" {
		st, err = s.backfill(ctx, client, connectionID, allowed, after, before, limit, gate, report)
	} else {
		st, err = s.incremental(ctx, client, connectionID, allowed, historyID, limit, gate, report)
	}
	if err != nil {
		if isInvalidGrant(err) {
			slog.Warn("token Gmail invalid_grant — tandai needs_reauth", "conn", shortID(connectionID))
			_, _ = s.pool.Exec(ctx, `UPDATE gmail_connections SET status='needs_reauth' WHERE id=$1::uuid`, connectionID)
			return st, apperr.Unauthorized("token Gmail kedaluwarsa — hubungkan ulang di Akun")
		}
		if ctx.Err() != nil {
			return st, ctx.Err()
		}
		slog.Error("sync gagal", "conn", shortID(connectionID), "mode", mode, "error", err)
		return st, err
	}

	// Pemulihan: email yang transaksinya dihapus manual dikembalikan ke antrean
	// agar diekstrak ulang lalu diaktifkan kembali (CreateEmail restore + update).
	if _, err := s.pool.Exec(ctx, `UPDATE raw_emails r SET status='fetched'
		WHERE r.connection_id=$1::uuid AND r.status <> 'fetched'
		AND EXISTS (SELECT 1 FROM transactions t WHERE t.raw_email_id=r.id AND t.deleted_at IS NOT NULL)`,
		connectionID); err != nil {
		slog.Warn("gagal reset raw_emails terhapus", "conn", shortID(connectionID), "error", err)
	}

	// ekstraksi inline terbatas; ikut batas scan
	if s.Extract != nil {
		batch := limit
		if batch <= 0 || batch > 25 {
			batch = 25
		}
		st.Extracted = s.extractNew(ctx, connectionID, batch)
	}
	slog.Info("sync selesai",
		"conn", shortID(connectionID), "mode", mode,
		"listed", st.Listed, "baru", st.New, "diabaikan", st.Gated, "diekstrak", st.Extracted)
	return st, nil
}

func isInvalidGrant(err error) bool {
	return err != nil && strings.Contains(err.Error(), "invalid_grant")
}

func (s *Service) backfill(ctx context.Context, client gmailClient, connectionID string, allowed map[string]bool, after, before time.Time, limit int, gate func() error, report func(Progress)) (Stats, error) {
	var st Stats
	if after.IsZero() {
		after = time.Now().AddDate(0, 0, -30)
	}
	st.Limit = limit
	if !before.IsZero() {
		st.BackfillDays = int(before.Sub(after).Hours() / 24)
	} else {
		st.BackfillDays = int(time.Since(after).Hours() / 24)
	}
	q := buildQuery(keys(allowed), after, before)
	pageToken := ""
	processed := 0
	for page := 0; page < 20; page++ {
		if limit > 0 && processed >= limit {
			break
		}
		if err := gate(); err != nil {
			return st, err
		}
		ids, next, err := client.ListIDs(ctx, q, pageToken)
		if err != nil {
			return st, err
		}
		st.Listed += len(ids)
		for _, id := range ids {
			if limit > 0 && processed >= limit {
				break
			}
			if err := gate(); err != nil {
				return st, err
			}
			n, g, dom, subj := s.processOne(ctx, client, connectionID, allowed, id)
			processed++
			if n {
				st.New++
			}
			if g {
				st.Gated++
			}
			report(Progress{Status: "running", Processed: processed, Total: limit, New: st.New, Gated: st.Gated, Current: dom + " — " + truncate(subj, 60)})
		}
		pageToken = next
		if pageToken == "" {
			break
		}
	}
	hid, err := client.HistoryIDNow(ctx)
	if err != nil {
		return st, err
	}
	_, _ = s.pool.Exec(ctx, `UPDATE gmail_connections SET history_id=$2, last_synced_at=now() WHERE id=$1::uuid`, connectionID, fmt.Sprint(hid))
	return st, nil
}

func (s *Service) incremental(ctx context.Context, client gmailClient, connectionID string, allowed map[string]bool, historyID string, limit int, gate func() error, report func(Progress)) (Stats, error) {
	var st Stats
	st.Limit = limit
	hid, err := strconv.ParseUint(strings.TrimSpace(historyID), 10, 64)
	if err != nil || hid == 0 {
		return s.backfill(ctx, client, connectionID, allowed, time.Now().AddDate(0, 0, -7), time.Time{}, limit, gate, report)
	}
	ids, newHID, expired, err := client.HistoryAdded(ctx, hid)
	if err != nil {
		return st, err
	}
	if expired {
		return s.backfill(ctx, client, connectionID, allowed, time.Now().AddDate(0, 0, -7), time.Time{}, limit, gate, report)
	}
	st.Listed = len(ids)
	processed := 0
	for _, id := range ids {
		if limit > 0 && processed >= limit {
			break
		}
		if err := gate(); err != nil {
			return st, err
		}
		isNew, gated, dom, subj := s.processOne(ctx, client, connectionID, allowed, id)
		processed++
		if isNew {
			st.New++
		}
		if gated {
			st.Gated++
		}
		report(Progress{Status: "running", Processed: processed, Total: len(ids), New: st.New, Gated: st.Gated, Current: dom + " — " + truncate(subj, 60)})
	}
	_, _ = s.pool.Exec(ctx, `UPDATE gmail_connections SET history_id=$2, last_synced_at=now() WHERE id=$1::uuid`, connectionID, fmt.Sprint(newHID))
	return st, nil
}

// processOne: fetch → clean → gate → simpan idempoten. Return (baru, gated, domain, subject).
func (s *Service) processOne(ctx context.Context, client gmailClient, connectionID string, allowed map[string]bool, gmailID string) (bool, bool, string, string) {
	msg, err := client.Get(ctx, gmailID)
	if err != nil {
		slog.Warn("gagal ambil email", "conn", shortID(connectionID), "gmail_id", gmailID, "error", err)
		return false, false, "", ""
	}
	c := CleanMessage(msg)
	dom := senderDomain(c.From)
	if !allowed[dom] {
		slog.Debug("email dilewati (pengirim tak diizinkan)", "conn", shortID(connectionID), "sender", dom)
		return false, false, dom, c.Subject
	}
	hash := sha256.Sum256([]byte(strings.ToLower(strings.Join(strings.Fields(c.Text), " "))))
	ch := hex.EncodeToString(hash[:])
	var inserted bool
	err = s.pool.QueryRow(ctx, `INSERT INTO raw_emails (connection_id, gmail_message_id, content_hash, status, parser_version, received_at)
		VALUES ($1::uuid,$2,$3,'fetched','v1',$4)
		ON CONFLICT (connection_id, gmail_message_id) DO NOTHING
		RETURNING true`, connectionID, gmailID, ch, nullTime(c.InternalDate)).Scan(&inserted)
	if err != nil || !inserted {
		slog.Debug("email duplikat dilewati", "conn", shortID(connectionID), "sender", dom, "gmail_id", gmailID)
		return false, false, dom, c.Subject
	}
	pass, reason := Gate(c.From, c.Subject, c.Text)
	if !pass {
		slog.Info("email diabaikan",
			"conn", shortID(connectionID), "sender", dom,
			"subject", truncate(c.Subject, 90), "reason", reason)
		_, _ = s.pool.Exec(ctx, `UPDATE raw_emails SET status='gated_out', ignore_reason=$3 WHERE connection_id=$1::uuid AND gmail_message_id=$2`, connectionID, gmailID, reason)
		return true, true, dom, c.Subject
	}
	slog.Info("email diambil",
		"conn", shortID(connectionID), "sender", dom,
		"subject", truncate(c.Subject, 90), "received", c.InternalDate.Format("2006-01-02 15:04"))
	return true, false, dom, c.Subject
}

func shortID(id string) string {
	if len(id) > 8 {
		return id[:8]
	}
	return id
}

func truncate(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

func (s *Service) extractNew(ctx context.Context, connectionID string, limit int) int {
	if s.Extract == nil {
		return 0
	}
	rows, err := s.pool.Query(ctx, `SELECT id::text FROM raw_emails
		WHERE connection_id=$1::uuid AND status='fetched' ORDER BY received_at DESC LIMIT $2`, connectionID, limit)
	if err != nil {
		return 0
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			continue
		}
		if err := s.Extract.ProcessRaw(ctx, id); err == nil {
			n++
		}
	}
	return n
}

// ---- sender registry & status ----

// AddSender menambah entri sender registry manual (is_seed=false) milik user.
func (s *Service) AddSender(ctx context.Context, uid, domain, label string) (map[string]any, error) {
	domain = strings.ToLower(strings.TrimSpace(domain))
	domain = strings.TrimSpace(strings.TrimPrefix(domain, "@"))
	label = strings.TrimSpace(label)
	if domain == "" {
		return nil, apperr.Invalid("domain pengirim wajib diisi")
	}
	if label == "" {
		label = domain
	}
	var id, outDomain, outLabel string
	err := s.pool.QueryRow(ctx, `INSERT INTO sender_registry (domain, label, is_seed, enabled, created_by)
		VALUES ($1,$2,false,true,$3)
		ON CONFLICT (domain) DO UPDATE SET label=EXCLUDED.label
		WHERE sender_registry.created_by = $3
		RETURNING id::text, domain, label`, domain, label, uid).Scan(&id, &outDomain, &outLabel)
	if err != nil {
		return nil, apperr.Conflict("domain sudah terdaftar")
	}
	return map[string]any{"id": id, "domain": outDomain, "label": outLabel, "is_seed": false, "can_delete": true}, nil
}

// DeleteSender menghapus entri manual milik user; seed / milik user lain ditolak.
func (s *Service) DeleteSender(ctx context.Context, uid, id string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var domain string
	if err := tx.QueryRow(ctx, `DELETE FROM sender_registry WHERE id=$1::uuid AND created_by=$2 RETURNING domain`, id, uid).Scan(&domain); err != nil {
		return apperr.NotFound("pengirim tidak ditemukan atau bukan milik Anda")
	}
	_, _ = tx.Exec(ctx, `DELETE FROM user_senders WHERE sender_domain=$1`, domain)
	return tx.Commit(ctx)
}

func (s *Service) Status(ctx context.Context, uid, connectionID string) (map[string]any, error) {
	var lastSynced any
	var histID, status, window string
	var backfillDays, scanLimit int
	var scanFrom, scanTo *time.Time
	err := s.pool.QueryRow(ctx, `SELECT last_synced_at, COALESCE(history_id,''), status, backfill_days, scan_limit, scan_window, scan_from, scan_to
		FROM gmail_connections WHERE id=$1::uuid AND user_id=$2`, connectionID, uid).
		Scan(&lastSynced, &histID, &status, &backfillDays, &scanLimit, &window, &scanFrom, &scanTo)
	if err != nil {
		return nil, apperr.NotFound("koneksi Gmail tidak ditemukan")
	}
	rows, _ := s.pool.Query(ctx, `SELECT status, COUNT(*) FROM raw_emails WHERE connection_id=$1::uuid GROUP BY 1`, connectionID)
	counts := map[string]int{}
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var k string
			var v int
			if err := rows.Scan(&k, &v); err == nil {
				counts[k] = v
			}
		}
	}
	var total int
	_ = s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM raw_emails WHERE connection_id=$1::uuid`, connectionID).Scan(&total)
	out := map[string]any{
		"status": status, "last_synced_at": lastSynced,
		"history_cursor": histID != "", "counts": counts, "total_scanned": total,
		"backfill_days": backfillDays, "scan_limit": scanLimit, "scan_window": window,
	}
	if scanFrom != nil {
		out["scan_from"] = scanFrom.Format("2006-01-02")
	}
	if scanTo != nil {
		out["scan_to"] = scanTo.Format("2006-01-02")
	}
	return out, nil
}

// SetSettings menyimpan preferensi scan (jendela + batas email per sync).
// window="custom" memakai rentang eksplisit scanFrom/scanTo (YYYY-MM-DD).
func (s *Service) SetSettings(ctx context.Context, uid, connectionID, window string, scanLimit int, scanFrom, scanTo string) error {
	if !validWindow(window) {
		window = "30d"
	}
	if scanLimit <= 0 || scanLimit > 1000 {
		scanLimit = 100
	}
	var fromArg, toArg any
	backfillDays := windowDays(window)
	if window == "custom" {
		f, ferr := time.Parse("2006-01-02", scanFrom)
		t, terr := time.Parse("2006-01-02", scanTo)
		if ferr != nil || terr != nil || t.Before(f) {
			return apperr.Invalid("rentang tanggal tidak valid")
		}
		fromArg, toArg = f, t
		backfillDays = int(t.Sub(f).Hours()/24) + 1
	}
	ct, err := s.pool.Exec(ctx, `UPDATE gmail_connections SET scan_window=$3, backfill_days=$4, scan_limit=$5, scan_from=$6, scan_to=$7
		WHERE id=$1::uuid AND user_id=$2`, connectionID, uid, window, backfillDays, scanLimit, fromArg, toArg)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return apperr.NotFound("koneksi Gmail tidak ditemukan")
	}
	return nil
}

func keys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// FetchText mengambil ulang email dari Gmail + clean (ekstraksi tidak
// menyimpan body mentah sama sekali — privasi maksimal, PLAN §7 retensi nol).
func (s *Service) FetchText(ctx context.Context, connectionID, gmailID string) (from, subject, text string, received time.Time, err error) {
	var encTok string
	if err := s.pool.QueryRow(ctx, `SELECT enc_refresh_token FROM gmail_connections WHERE id=$1::uuid`, connectionID).Scan(&encTok); err != nil {
		return "", "", "", time.Time{}, err
	}
	rt, err := s.enc.Decrypt(encTok)
	if err != nil {
		return "", "", "", time.Time{}, err
	}
	client, err := s.newClient(ctx, rt)
	if err != nil {
		return "", "", "", time.Time{}, err
	}
	msg, err := client.Get(ctx, gmailID)
	if err != nil {
		return "", "", "", time.Time{}, err
	}
	c := CleanMessage(msg)
	return c.From, c.Subject, c.Text, c.InternalDate, nil
}

func nullTime(t time.Time) any {
	if t.IsZero() {
		return nil
	}
	return t.UTC()
}
