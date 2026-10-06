package extraction

import (
	"context"
	"strconv"
	"testing"
	"time"

	"github.com/semmidev/spendly/internal/modules/ledger"
	"github.com/semmidev/spendly/internal/modules/mailsync"
	"github.com/semmidev/spendly/internal/platform/config"
	"github.com/semmidev/spendly/internal/platform/security"
	"github.com/semmidev/spendly/internal/provider/llm"
	"github.com/semmidev/spendly/internal/testutil"
)

// TestPipelineIntegration menguji pipeline penuh di Postgres nyata
// (testcontainers): insert → dedup fingerprint → ignored → review → confirm.
func TestPipelineIntegration(t *testing.T) {
	pool := testutil.StartPostgres(t)
	ctx := context.Background()
	cfg := &config.Config{AIModel: "test"}
	enc, _ := security.NewAESEncryptor("0123456789abcdef0123456789abcdef")
	svc := NewService(pool, cfg, mailsync.NewService(pool, cfg, enc))

	uid := ledger.EnsureDevUser(ctx, pool)
	var connID string
	err := pool.QueryRow(ctx, `INSERT INTO gmail_connections (user_id, google_email, enc_refresh_token, status)
		VALUES ($1,'t@x.id','x','active') RETURNING id::text`, uid).Scan(&connID)
	if err != nil {
		t.Fatalf("insert connection: %v", err)
	}

	newRaw := func() string {
		var id string
		suffix := strconv.Itoa(int(time.Now().UnixNano()))
		if err := pool.QueryRow(ctx, `INSERT INTO raw_emails (connection_id, gmail_message_id, content_hash, status)
			VALUES ($1::uuid,$2,$3,'fetched') RETURNING id::text`,
			connID, "g"+suffix, "h"+suffix).Scan(&id); err != nil {
			t.Fatalf("insert raw: %v", err)
		}
		return id
	}
	str := func(s string) *string { return &s }

	res := llm.Result{IsExpense: true, Kind: "purchase", AmountRaw: str("Rp 27.500"),
		Currency: "IDR", Merchant: "Grab", OccurredAtRaw: str("05 Okt 2026 10:00 WIB"),
		ReferenceNo: str("REF123"), Category: str("Transport"), Confidence: 0.9}

	// 1. transaksi normal → confirmed
	raw := newRaw()
	if err := svc.apply(ctx, raw, uid, time.Now(), res, llm.Usage{}, false); err != nil {
		t.Fatalf("apply: %v", err)
	}
	var status string
	_ = pool.QueryRow(ctx, `SELECT status FROM transactions WHERE raw_email_id=$1::uuid`, raw).Scan(&status)
	if status != "confirmed" {
		t.Fatalf("status=%q mau confirmed", status)
	}

	// 2. reference_no sama → dedup (fingerprint UNIQUE)
	raw2 := newRaw()
	if err := svc.apply(ctx, raw2, uid, time.Now(), res, llm.Usage{}, false); err != nil {
		t.Fatalf("apply dup: %v", err)
	}
	_ = pool.QueryRow(ctx, `SELECT status FROM raw_emails WHERE id=$1::uuid`, raw2).Scan(&status)
	if status != "dedup" {
		t.Fatalf("duplikat: status=%q mau dedup", status)
	}

	// 3. topup_own → ignored
	raw3 := newRaw()
	top := llm.Result{IsExpense: false, Kind: "topup_own", Currency: "IDR", Confidence: 0.9}
	if err := svc.apply(ctx, raw3, uid, time.Now(), top, llm.Usage{}, false); err != nil {
		t.Fatalf("apply topup: %v", err)
	}
	_ = pool.QueryRow(ctx, `SELECT status FROM raw_emails WHERE id=$1::uuid`, raw3).Scan(&status)
	if status != "ignored" {
		t.Fatalf("topup: status=%q mau ignored", status)
	}

	// 4. confidence rendah → needs_review, lalu confirm
	raw4 := newRaw()
	low := llm.Result{IsExpense: true, Kind: "purchase", AmountRaw: str("Rp 10.000"),
		Currency: "IDR", Merchant: "Warung", Confidence: 0.3}
	if err := svc.apply(ctx, raw4, uid, time.Now(), low, llm.Usage{}, false); err != nil {
		t.Fatalf("apply lowconf: %v", err)
	}
	var txID string
	_ = pool.QueryRow(ctx, `SELECT id::text, status FROM transactions WHERE raw_email_id=$1::uuid`, raw4).Scan(&txID, &status)
	if status != "needs_review" {
		t.Fatalf("lowconf: status=%q mau needs_review", status)
	}
	if _, ok := ledger.NewStorePG(pool).Confirm(txID, uid, "Makanan"); !ok {
		t.Fatal("confirm gagal")
	}
	_ = pool.QueryRow(ctx, `SELECT status FROM transactions WHERE id=$1::uuid`, txID).Scan(&status)
	if status != "confirmed" {
		t.Fatalf("confirm: status=%q", status)
	}

	// 5. nominal invalid → needs_review, amount 0, TIDAK crash (CHECK amount>=0)
	raw5 := newRaw()
	bad := llm.Result{IsExpense: true, Kind: "purchase", AmountRaw: str("tidak disebut"),
		Currency: "IDR", Merchant: "X", Confidence: 0.9}
	if err := svc.apply(ctx, raw5, uid, time.Now(), bad, llm.Usage{}, false); err != nil {
		t.Fatalf("apply bad amount: %v", err)
	}
	var amt int64
	_ = pool.QueryRow(ctx, `SELECT amount, status FROM transactions WHERE raw_email_id=$1::uuid`, raw5).Scan(&amt, &status)
	if amt != 0 || status != "needs_review" {
		t.Fatalf("bad amount: amount=%d status=%q", amt, status)
	}

	// 6. transaksi dihapus manual → dipulihkan (id sama) saat raw_email yang
	//    sama diproses ulang (upsert per raw_email_id).
	var tx1 string
	_ = pool.QueryRow(ctx, `SELECT id::text FROM transactions WHERE raw_email_id=$1::uuid`, raw).Scan(&tx1)
	if _, err := pool.Exec(ctx, `UPDATE transactions SET deleted_at=now() WHERE id=$1::uuid`, tx1); err != nil {
		t.Fatalf("soft delete: %v", err)
	}
	if err := svc.apply(ctx, raw, uid, time.Now(), res, llm.Usage{}, false); err != nil {
		t.Fatalf("apply restore: %v", err)
	}
	var gotID string
	var deletedAt any
	if err := pool.QueryRow(ctx, `SELECT id::text, deleted_at FROM transactions WHERE id=$1::uuid`, tx1).Scan(&gotID, &deletedAt); err != nil {
		t.Fatalf("select restored: %v", err)
	}
	if deletedAt != nil {
		t.Fatalf("transaksi tidak dipulihkan: deleted_at=%v", deletedAt)
	}
	if gotID != tx1 {
		t.Fatalf("transaksi dipulihkan sebagai baris baru: %s != %s", gotID, tx1)
	}

	// 7. raw_email_id unik: proses ulang berulang tetap satu transaksi.
	for i := 0; i < 3; i++ {
		if err := svc.apply(ctx, raw, uid, time.Now(), res, llm.Usage{}, false); err != nil {
			t.Fatalf("apply reprocess #%d: %v", i, err)
		}
	}
	var cnt int
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM transactions WHERE raw_email_id=$1::uuid`, raw).Scan(&cnt)
	if cnt != 1 {
		t.Fatalf("duplikat raw_email_id: count=%d mau 1", cnt)
	}
}

// TestReenableDeletedWithoutAI: email yang transaksinya dihapus user
// dipulihkan dari cache ekstraksi (content_hash) — tanpa panggilan AI/parser
// ulang. Bukti: extractions.model berawalan "cache:" dan baris transaksi
// yang sama diaktifkan lagi (deleted_at NULL, id sama).
func TestReenableDeletedWithoutAI(t *testing.T) {
	pool := testutil.StartPostgres(t)
	ctx := context.Background()
	cfg := &config.Config{AIModel: "test"} // tanpa API key → ai nil
	enc, _ := security.NewAESEncryptor("0123456789abcdef0123456789abcdef")
	svc := NewService(pool, cfg, mailsync.NewService(pool, cfg, enc))

	uid := ledger.EnsureDevUser(ctx, pool)
	var connID string
	if err := pool.QueryRow(ctx, `INSERT INTO gmail_connections (user_id, google_email, enc_refresh_token, status)
		VALUES ($1,'t@x.id','x','active') RETURNING id::text`, uid).Scan(&connID); err != nil {
		t.Fatalf("insert connection: %v", err)
	}
	var raw string
	if err := pool.QueryRow(ctx, `INSERT INTO raw_emails (connection_id, gmail_message_id, content_hash, status, received_at)
		VALUES ($1::uuid,'gmail-del-1','hash-del-1','fetched',now()) RETURNING id::text`, connID).Scan(&raw); err != nil {
		t.Fatalf("insert raw: %v", err)
	}
	str := func(s string) *string { return &s }
	res := llm.Result{IsExpense: true, Kind: "purchase", AmountRaw: str("Rp 27.500"),
		Currency: "IDR", Merchant: "Grab", OccurredAtRaw: str("05 Okt 2026 10:00 WIB"),
		ReferenceNo: str("REUSE9"), Category: str("Transport"), Confidence: 0.9}
	if err := svc.apply(ctx, raw, uid, time.Now(), res, llm.Usage{}, false); err != nil {
		t.Fatalf("apply: %v", err)
	}
	var txID string
	_ = pool.QueryRow(ctx, `SELECT id::text FROM transactions WHERE raw_email_id=$1::uuid`, raw).Scan(&txID)

	// User menghapus transaksi; sync berikutnya me-reset raw ke fetched
	// (SQL sama persis seperti runSync) lalu memproses ulang.
	if _, err := pool.Exec(ctx, `UPDATE transactions SET deleted_at=now() WHERE id=$1::uuid`, txID); err != nil {
		t.Fatalf("soft delete: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE raw_emails r SET status='fetched'
		WHERE r.connection_id=$1::uuid AND r.status <> 'fetched'
		AND EXISTS (SELECT 1 FROM transactions t WHERE t.raw_email_id=r.id AND t.deleted_at IS NOT NULL)`, connID); err != nil {
		t.Fatalf("reset: %v", err)
	}
	fetched := false
	svc.fetchText = func(ctx context.Context, connID, gmailID string) (string, string, string, time.Time, error) {
		fetched = true
		return "Bank <noreply@bca.co.id>", "Transaksi Berhasil",
			"Pembayaran Rp 27.500 ke Grab berhasil. Ref REUSE9.", time.Now(), nil
	}
	if err := svc.ProcessRaw(ctx, raw); err != nil {
		t.Fatalf("ProcessRaw: %v", err)
	}
	if !fetched {
		t.Fatal("teks email tidak dibaca ulang")
	}
	var model string
	_ = pool.QueryRow(ctx, `SELECT model FROM extractions WHERE raw_email_id=$1::uuid`, raw).Scan(&model)
	if len(model) < 6 || model[:6] != "cache:" {
		t.Fatalf("bukan dari cache (AI/parser jalan ulang?): model=%q", model)
	}
	var gotID string
	var deletedAt any
	if err := pool.QueryRow(ctx, `SELECT id::text, deleted_at FROM transactions WHERE id=$1::uuid`, txID).Scan(&gotID, &deletedAt); err != nil {
		t.Fatalf("select restored: %v", err)
	}
	if gotID != txID || deletedAt != nil {
		t.Fatalf("tidak di-enable-kan lagi: id=%s deleted_at=%v", gotID, deletedAt)
	}
}
