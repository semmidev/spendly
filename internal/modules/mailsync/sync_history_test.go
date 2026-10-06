package mailsync

import (
	"context"
	"testing"
)

// TestSyncHistoryAndDetail: riwayat urut terbaru dulu + terisolasi per user,
// detail hanya memuat email dalam jendela job-nya.
func TestSyncHistoryAndDetail(t *testing.T) {
	svc, uid, connID := setupJobTest(t)
	ctx := context.Background()

	mkJob := func(id, status string, created, finished string) {
		_, err := svc.pool.Exec(ctx, `INSERT INTO sync_jobs (id, user_id, connection_id, status, mode, new_count, created_at, finished_at)
			VALUES ($1::uuid,$2,$3::uuid,$4,'backfill',1,$5::timestamptz,$6::timestamptz)`,
			id, uid, connID, status, created, finished)
		if err != nil {
			t.Fatalf("insert job: %v", err)
		}
	}
	mkJob("11111111-1111-1111-1111-111111111111", "done", "2026-10-01 10:00+07", "2026-10-01 10:05+07")
	mkJob("22222222-2222-2222-2222-222222222222", "done", "2026-09-01 10:00+07", "2026-09-01 10:02+07")

	mkRaw := func(gmailID, subject, created string) {
		_, err := svc.pool.Exec(ctx, `INSERT INTO raw_emails (connection_id, gmail_message_id, content_hash, status, subject, sender_domain, received_at, created_at)
			VALUES ($1::uuid,$2,$3,'parsed',$4,'bca.co.id','2026-10-01 09:00+07',$5::timestamptz)`,
			connID, gmailID, "h-"+gmailID, subject, created)
		if err != nil {
			t.Fatalf("insert raw: %v", err)
		}
	}
	mkRaw("g-in", "Struk Pembayaran", "2026-10-01 10:01+07") // dalam jendela job 1
	mkRaw("g-out", "Struk Lama", "2026-08-01 10:00+07")      // di luar semua jendela

	// Job milik user lain tidak boleh bocor.
	var otherUID string
	_ = svc.pool.QueryRow(ctx, `INSERT INTO users (google_sub, email, name)
		VALUES ('other','o@t.id','Other') RETURNING id::text`).Scan(&otherUID)
	var otherConn string
	_ = svc.pool.QueryRow(ctx, `INSERT INTO gmail_connections (user_id, google_email, enc_refresh_token, status)
		VALUES ($1,'o@gmail.com','x','active') RETURNING id::text`, otherUID).Scan(&otherConn)
	_, _ = svc.pool.Exec(ctx, `INSERT INTO sync_jobs (id, user_id, connection_id, status, created_at)
		VALUES ('33333333-3333-3333-3333-333333333333',$1,$2::uuid,'done',now())`, otherUID, otherConn)

	items := svc.SyncHistory(ctx, uid, connID, 20)
	if len(items) != 2 {
		t.Fatalf("history=%d mau 2 (tanpa milik user lain)", len(items))
	}
	if items[0]["id"] != "11111111-1111-1111-1111-111111111111" {
		t.Fatalf("urutan bukan terbaru dulu: %v", items[0]["id"])
	}

	d, err := svc.SyncDetail(ctx, uid, "11111111-1111-1111-1111-111111111111")
	if err != nil {
		t.Fatalf("detail: %v", err)
	}
	emails, _ := d["emails"].([]map[string]any)
	if len(emails) != 1 {
		t.Fatalf("emails=%d mau 1 (hanya dalam jendela)", len(emails))
	}
	if emails[0]["subject"] != "Struk Pembayaran" || emails[0]["sender_domain"] != "bca.co.id" {
		t.Fatalf("meta email hilang: %+v", emails[0])
	}
	if _, err := svc.SyncDetail(ctx, otherUID, "11111111-1111-1111-1111-111111111111"); err == nil {
		t.Fatal("detail bocor ke user lain")
	}
	if _, err := svc.SyncDetail(ctx, uid, "99999999-9999-9999-9999-999999999999"); err == nil {
		t.Fatal("detail job fiktif harus NotFound")
	}
}
