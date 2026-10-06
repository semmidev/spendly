package e2e

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

// TestReviewIgnoredIncludeEmail: antrean Tinjau & Diabaikan memuat info email
// (subjek, pengirim) untuk modal detail.
func TestReviewIgnoredIncludeEmail(t *testing.T) {
	a := newAPI(t)
	a.login()
	ctx := context.Background()

	var uid string
	if err := a.pool.QueryRow(ctx, `SELECT id::text FROM users WHERE google_sub='dev'`).Scan(&uid); err != nil {
		t.Fatalf("dev user: %v", err)
	}
	var conn string
	if err := a.pool.QueryRow(ctx, `INSERT INTO gmail_connections (user_id, google_email, enc_refresh_token, status)
		VALUES ($1,'t@gmail.com','x','active') RETURNING id::text`, uid).Scan(&conn); err != nil {
		t.Fatalf("conn: %v", err)
	}
	var raw string
	if err := a.pool.QueryRow(ctx, `INSERT INTO raw_emails (connection_id, gmail_message_id, content_hash, status, subject, sender_domain, received_at)
		VALUES ($1::uuid,'g-mail-1','h-mail-1','parsed','Struk Pembayaran BCA','bca.co.id',now()) RETURNING id::text`, conn).Scan(&raw); err != nil {
		t.Fatalf("raw: %v", err)
	}
	if _, err := a.pool.Exec(ctx, `INSERT INTO transactions (user_id, amount, currency, occurred_at, source, raw_email_id, status, confidence)
		VALUES ($1,25000,'IDR',now(),'email',$2::uuid,'needs_review',0.85)`, uid, raw); err != nil {
		t.Fatalf("txn: %v", err)
	}

	code, body := a.do("GET", "/api/v1/review-queue", nil, false)
	if code != http.StatusOK {
		t.Fatalf("review-queue = %d", code)
	}
	for _, want := range []string{`"email_subject":"Struk Pembayaran BCA"`, `"email_sender":"bca.co.id"`, `"confidence":0.85`} {
		if !strings.Contains(string(body), want) {
			t.Fatalf("review-queue tanpa %s: %s", want, body)
		}
	}

	// Pindah ke Diabaikan: transaksi ignored + email gated_out.
	if _, err := a.pool.Exec(ctx, `UPDATE transactions SET status='ignored' WHERE raw_email_id=$1::uuid`, raw); err != nil {
		t.Fatalf("ignore txn: %v", err)
	}
	var raw2 string
	if err := a.pool.QueryRow(ctx, `INSERT INTO raw_emails (connection_id, gmail_message_id, content_hash, status, subject, sender_domain, ignore_reason, received_at)
		VALUES ($1::uuid,'g-mail-2','h-mail-2','gated_out','Promo 12.12','tokopedia.com','promo',now()) RETURNING id::text`, conn).Scan(&raw2); err != nil {
		t.Fatalf("raw2: %v", err)
	}
	_ = raw2

	code, body = a.do("GET", "/api/v1/ignored", nil, false)
	if code != http.StatusOK {
		t.Fatalf("ignored = %d", code)
	}
	for _, want := range []string{`"email_subject":"Struk Pembayaran BCA"`, `"subject":"Promo 12.12"`, `"sender_domain":"tokopedia.com"`} {
		if !strings.Contains(string(body), want) {
			t.Fatalf("ignored tanpa %s: %s", want, body)
		}
	}
}
