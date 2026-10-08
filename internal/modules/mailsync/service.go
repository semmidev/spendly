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

// windowStart: batas awal (inklusif) preset jendela. "month" = tanggal 1 bulan
// berjalan (00:00 lokal), bukan "N hari ke belakang" (yang bisa menarik tanggal
// dari bulan lalu).
func windowStart(window string, now time.Time) time.Time {
	if window == "month" {
		return time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	}
	days := windowDays(window)
	if days <= 0 {
		days = 30
	}
	return now.AddDate(0, 0, -days)
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
func (s *Service) runSync(ctx context.Context, uid, connectionID string, force bool, maxEmails int, gate func() error, report func(Progress)) (Stats, error) {
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
	mode := "incremental"
	switch {
	case window == "custom" && scanFrom != nil && scanTo != nil:
		// Rentang eksplisit; `before` eksklusif di Gmail → +1 hari agar `scan_to` ikut.
		after = time.Date(scanFrom.Year(), scanFrom.Month(), scanFrom.Day(), 0, 0, 0, 0, time.Local)
		before = time.Date(scanTo.Year(), scanTo.Month(), scanTo.Day(), 0, 0, 0, 0, time.Local).AddDate(0, 0, 1)
		mode = "backfill"
	default:
		// Batas awal preset: "month" = tanggal 1 bulan berjalan, bukan N hari ke belakang.
		after = windowStart(window, time.Now())
		if force || historyID == "" {
			mode = "backfill"
		}
	}
	days := int(time.Since(after).Hours()/24) + 1
	if !before.IsZero() {
		days = int(before.Sub(after).Hours() / 24)
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

	// Email yang transaksinya dihapus user (Sampah) TIDAK dikembalikan ke
	// antrean: yang dihapus tetap hilang, tidak diproses atau diaktifkan lagi.
	// Pemulihan hanya lewat tombol "Pulihkan" oleh user sendiri.

	// ekstraksi: proses SEMUA email berstatus 'fetched' sampai habis agar sync
	// tamat dalam satu sesi; berhenti hanya bila dijeda/dibatalkan (gate).
	if s.Extract != nil {
		n, xerr := s.extractNew(ctx, connectionID, gate, report)
		st.Extracted = n
		if xerr != nil {
			return st, xerr
		}
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
	// Proses SEMUA id baru sejak cursor; limit scan hanya membatasi backfill.
	// Bila limit diterapkan di sini, cursor tetap maju dan email berlebih hilang.
	for _, id := range ids {
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

// processOne: filter allowlist via metadata → fetch → clean → gate → simpan
// idempoten. Body email dari pengirim yang tidak dicentang tidak pernah
// diunduh (hemat kuota + privasi). Return (baru, gated, domain, subject).
func (s *Service) processOne(ctx context.Context, client gmailClient, connectionID string, allowed map[string]bool, gmailID string) (bool, bool, string, string) {
	// Lapisan 1: header From saja. Gagal metadata → lanjut ke Get penuh
	// (fail-open; cek autoritatif di bawah tetap jalan).
	if meta, merr := client.GetMetadata(ctx, gmailID); merr == nil {
		if dom := senderDomain(headerFrom(meta)); dom != "" && !allowed[dom] {
			slog.Debug("email dilewati (pengirim tak diizinkan)", "conn", shortID(connectionID), "sender", dom)
			return false, false, dom, ""
		}
	}
	msg, err := client.Get(ctx, gmailID)
	if err != nil {
		slog.Warn("gagal ambil email", "conn", shortID(connectionID), "gmail_id", gmailID, "error", err)
		s.recordItemError(ctx, connectionID, gmailID, "ambil email: "+err.Error())
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
	err = s.pool.QueryRow(ctx, `INSERT INTO raw_emails (connection_id, gmail_message_id, content_hash, status, parser_version, received_at, subject, sender_domain)
		VALUES ($1::uuid,$2,$3,'fetched','v1',$4,$5,$6)
		ON CONFLICT (connection_id, gmail_message_id) DO UPDATE
			SET status='fetched', error=NULL
			WHERE raw_emails.status='failed'
		RETURNING true`, connectionID, gmailID, ch, nullTime(c.InternalDate), c.Subject, dom).Scan(&inserted)
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

// recordItemError menyimpan kegagalan ambil email sebagai baris raw_emails
// 'failed' + pesan error, agar tampil di log detail & bisa diproses ulang.
// Baris yang sudah selesai (parsed/needs_review/dll) tidak ditimpa.
func (s *Service) recordItemError(ctx context.Context, connectionID, gmailID, msg string) {
	h := sha256.Sum256([]byte(gmailID))
	_, _ = s.pool.Exec(ctx, `INSERT INTO raw_emails (connection_id, gmail_message_id, content_hash, status, parser_version, error)
		VALUES ($1::uuid,$2,$3,'failed','v1',$4)
		ON CONFLICT (connection_id, gmail_message_id) DO UPDATE SET status='failed', error=EXCLUDED.error
		WHERE raw_emails.status IN ('fetched','failed')`,
		connectionID, gmailID, hex.EncodeToString(h[:]), truncate(msg, 300))
}

// headerFrom mengambil header From tanpa menyentuh body (untuk filter
// allowlist sebelum body diunduh). Tahan nil untuk respons metadata ganjil.
func headerFrom(msg *gmailapi.Message) string {
	if msg == nil || msg.Payload == nil {
		return ""
	}
	for _, h := range msg.Payload.Headers {
		if h != nil && strings.EqualFold(h.Name, "From") {
			return h.Value
		}
	}
	return ""
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

// extractNew memproses semua raw_emails berstatus 'fetched' dalam batch berulang
// sampai habis (atau gate minta berhenti). Error ekstraksi per-item dicatat ke
// raw_emails.error + status 'failed' agar sync tidak ikut berhenti dan bisa
// diproses ulang user. Return jumlah item sukses.
func (s *Service) extractNew(ctx context.Context, connectionID string, gate func() error, report func(Progress)) (int, error) {
	if s.Extract == nil {
		return 0, nil
	}
	const batch = 25
	total := 0
	for {
		if err := gate(); err != nil {
			return total, err
		}
		rows, err := s.pool.Query(ctx, `SELECT id::text FROM raw_emails
			WHERE connection_id=$1::uuid AND status='fetched' ORDER BY received_at DESC NULLS LAST LIMIT $2`, connectionID, batch)
		if err != nil {
			return total, err
		}
		var ids []string
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err == nil {
				ids = append(ids, id)
			}
		}
		rows.Close()
		if len(ids) == 0 {
			return total, nil
		}
		for _, id := range ids {
			if err := gate(); err != nil {
				return total, err
			}
			if err := s.Extract.ProcessRaw(ctx, id); err != nil {
				slog.Warn("ekstraksi item gagal", "raw", shortID(id), "error", err)
				_, _ = s.pool.Exec(ctx, `UPDATE raw_emails SET status='failed', error=$2
					WHERE id=$1::uuid AND status IN ('fetched','extracting')`, id, truncate(err.Error(), 300))
				continue
			}
			total++
			report(Progress{Status: "running", Extracted: total})
		}
	}
}

// ---- sender registry & status ----

// AddSender menambah entri sender registry manual (is_seed=false) milik user.
func (s *Service) AddSender(ctx context.Context, uid, domain, label, category string) (map[string]any, error) {
	domain = strings.ToLower(strings.TrimSpace(domain))
	domain = strings.TrimSpace(strings.TrimPrefix(domain, "@"))
	label = strings.TrimSpace(label)
	category = strings.TrimSpace(category)
	if domain == "" {
		return nil, apperr.Invalid("domain pengirim wajib diisi")
	}
	if label == "" {
		label = domain
	}
	if category == "" {
		category = "Lainnya"
	}
	var id, outDomain, outLabel, outCategory string
	err := s.pool.QueryRow(ctx, `INSERT INTO sender_registry (domain, label, category, is_seed, enabled, created_by)
		VALUES ($1,$2,$3,false,true,$4)
		ON CONFLICT (domain) DO UPDATE SET label=EXCLUDED.label, category=EXCLUDED.category
		WHERE sender_registry.created_by = $4
		RETURNING id::text, domain, label, category`, domain, label, category, uid).Scan(&id, &outDomain, &outLabel, &outCategory)
	if err != nil {
		return nil, apperr.Conflict("domain sudah terdaftar")
	}
	return map[string]any{"id": id, "domain": outDomain, "label": outLabel, "category": outCategory, "is_seed": false, "can_delete": true}, nil
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

// SyncHistory: N job terakhir koneksi ini (terbaru dulu) untuk tab Riwayat.
func (s *Service) SyncHistory(ctx context.Context, uid, connectionID string, limit int) []map[string]any {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	rows, err := s.pool.Query(ctx, `SELECT j.id::text, j.status, j.mode, j.processed, j.total,
		j.new_count, j.gated_count, j.extracted_count, j.scan_limit, j.message, j.created_at, j.finished_at
		FROM sync_jobs j
		WHERE j.user_id=$1 AND j.connection_id=$2::uuid
		ORDER BY j.created_at DESC LIMIT $3`, uid, connectionID, limit)
	if err != nil {
		return []map[string]any{}
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, status, mode, message string
		var processed, total, newC, gatedC, extC, scanLim int
		var created time.Time
		var finished *time.Time
		if err := rows.Scan(&id, &status, &mode, &processed, &total, &newC, &gatedC, &extC, &scanLim, &message, &created, &finished); err != nil {
			continue
		}
		out = append(out, map[string]any{
			"id": id, "status": status, "mode": mode, "processed": processed, "total": total,
			"new": newC, "gated": gatedC, "extracted": extC, "scan_limit": scanLim,
			"message": message, "created_at": created, "finished_at": finished,
		})
	}
	return out
}

// SyncDetail: satu job + email yang diproses dalam jendelanya (subject,
// domain, status, transaksi hasil). Email lama pra-migrasi 00015 tampil
// dengan subject/domain kosong.
func (s *Service) SyncDetail(ctx context.Context, uid, jobID string) (map[string]any, error) {
	var connID, status, mode, message string
	var processed, total, newC, gatedC, extC, scanLim int
	var created time.Time
	var finished *time.Time
	err := s.pool.QueryRow(ctx, `SELECT connection_id::text, status, mode, processed, total,
		new_count, gated_count, extracted_count, scan_limit, message, created_at, finished_at
		FROM sync_jobs WHERE id=$1::uuid AND user_id=$2`, jobID, uid).
		Scan(&connID, &status, &mode, &processed, &total, &newC, &gatedC, &extC, &scanLim, &message, &created, &finished)
	if err != nil {
		return nil, apperr.NotFound("riwayat sinkronisasi tidak ditemukan")
	}
	end := time.Now()
	if finished != nil {
		end = *finished
	}
	rows, err := s.pool.Query(ctx, `SELECT r.subject, r.sender_domain, r.status, r.ignore_reason, r.error, r.received_at,
		t.amount, t.currency, m.canonical_name, c.name, e.confidence
		FROM raw_emails r
		LEFT JOIN transactions t ON t.raw_email_id=r.id AND t.deleted_at IS NULL
		LEFT JOIN merchants m ON m.id=t.merchant_id
		LEFT JOIN categories c ON c.id=t.category_id
		LEFT JOIN extractions e ON e.raw_email_id=r.id
		WHERE r.connection_id=$1::uuid AND r.created_at BETWEEN $2 AND $3
		ORDER BY r.received_at DESC NULLS LAST LIMIT 200`, connID, created, end)
	emails := []map[string]any{}
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var subject, domain, st, reason, errMsg, merchant, cat, curr *string
			var received *time.Time
			var amount *int64
			var conf *float64
			if err := rows.Scan(&subject, &domain, &st, &reason, &errMsg, &received, &amount, &curr, &merchant, &cat, &conf); err != nil {
				continue
			}
			e := map[string]any{
				"subject": strVal(subject), "sender_domain": strVal(domain), "status": strVal(st),
				"ignore_reason": strVal(reason), "error": strVal(errMsg), "received_at": received,
			}
			if amount != nil {
				e["transaction"] = map[string]any{
					"amount": *amount, "currency": strVal(curr),
					"merchant": strVal(merchant), "category": strVal(cat),
				}
			}
			if conf != nil {
				e["confidence"] = *conf
			}
			emails = append(emails, e)
		}
	}
	return map[string]any{
		"job": map[string]any{
			"id": jobID, "status": status, "mode": mode, "processed": processed, "total": total,
			"new": newC, "gated": gatedC, "extracted": extC, "scan_limit": scanLim,
			"message": message, "created_at": created, "finished_at": finished,
		},
		"emails": emails,
	}, nil
}

func strVal(s *string) string {
	if s == nil {
		return ""
	}
	return *s
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
