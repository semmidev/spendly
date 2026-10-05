package mailsync

import (
	"context"
	"encoding/base64"
	"strings"
	"testing"
	"time"

	gmailapi "google.golang.org/api/gmail/v1"

	"github.com/semmidev/spendly/internal/platform/config"
	"github.com/semmidev/spendly/internal/platform/security"
	"github.com/semmidev/spendly/internal/testutil"
)

// stubGmail: klien Gmail palsu yang lambat agar job sempat di-pause/cancel.
type stubGmail struct {
	ids   []string
	delay time.Duration
}

func (s *stubGmail) ListIDs(ctx context.Context, query, pageToken string) ([]string, string, error) {
	return s.ids, "", nil
}

func (s *stubGmail) msg() *gmailapi.Message {
	text := "Kamu membayar Rp 25.000 ke TOKO*ABC pada 05 Okt 2026 10:00 WIB. Ref STUB1."
	data := strings.TrimRight(base64.URLEncoding.EncodeToString([]byte(text)), "=")
	return &gmailapi.Message{
		Id:           "stub",
		InternalDate: time.Now().UnixMilli(),
		Payload: &gmailapi.MessagePart{
			MimeType: "text/plain",
			Body:     &gmailapi.MessagePartBody{Data: data},
			Headers: []*gmailapi.MessagePartHeader{
				{Name: "From", Value: "Bank <noreply@bca.co.id>"},
				{Name: "Subject", Value: "Pembayaran berhasil"},
			},
		},
	}
}

func (s *stubGmail) Get(ctx context.Context, id string) (*gmailapi.Message, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-time.After(s.delay):
	}
	m := s.msg()
	m.Id = id
	return m, nil
}

func (s *stubGmail) GetMetadata(ctx context.Context, id string) (*gmailapi.Message, error) {
	return s.msg(), nil
}

func (s *stubGmail) HistoryIDNow(ctx context.Context) (uint64, error) { return 999, nil }

func (s *stubGmail) HistoryAdded(ctx context.Context, historyID uint64) ([]string, uint64, bool, error) {
	return nil, 999, false, nil
}

func setupJobTest(t *testing.T) (*Service, string, string) {
	t.Helper()
	pool := testutil.StartPostgres(t)
	ctx := context.Background()
	cfg := &config.Config{GoogleClientID: "x", GoogleClientSecret: "y"}
	enc, _ := security.NewAESEncryptor("0123456789abcdef0123456789abcdef")
	svc := NewService(pool, cfg, enc)
	stub := &stubGmail{ids: []string{"m1", "m2", "m3", "m4", "m5", "m6"}, delay: 400 * time.Millisecond}
	svc.newClient = func(ctx context.Context, rt string) (gmailClient, error) { return stub, nil }

	var uid string
	if err := pool.QueryRow(ctx, `INSERT INTO users (google_sub, email, name)
		VALUES ('jobtest','job@t.id','Job') ON CONFLICT (google_sub) DO UPDATE SET email=EXCLUDED.email
		RETURNING id::text`).Scan(&uid); err != nil {
		t.Fatalf("user: %v", err)
	}
	rt, _ := enc.Encrypt("refresh")
	var connID string
	if err := pool.QueryRow(ctx, `INSERT INTO gmail_connections (user_id, google_email, enc_refresh_token, status)
		VALUES ($1,'job@gmail.com',$2,'active') RETURNING id::text`, uid, rt).Scan(&connID); err != nil {
		t.Fatalf("conn: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO user_senders (connection_id, sender_domain, allowed)
		VALUES ($1::uuid,'bca.co.id',true)`, connID); err != nil {
		t.Fatalf("sender: %v", err)
	}
	return svc, uid, connID
}

func waitStatus(t *testing.T, svc *Service, jobID, uid, want string, timeout time.Duration) Progress {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for {
		p, ok := svc.SyncJobProgress(jobID, uid)
		if !ok {
			t.Fatalf("job hilang")
		}
		if p.Status == want {
			return p
		}
		if time.Now().After(deadline) {
			t.Fatalf("timeout menunggu %s (dapat %s)", want, p.Status)
		}
		time.Sleep(100 * time.Millisecond)
	}
}

// TestSyncJobLifecycle: start → aktif (DB) → pause → resume → selesai.
func TestSyncJobLifecycle(t *testing.T) {
	svc, uid, connID := setupJobTest(t)
	ctx := context.Background()

	jobID, err := svc.StartSyncJob(ctx, uid, connID, true, 6)
	if err != nil {
		t.Fatalf("start: %v", err)
	}

	// Terlihat sebagai aktif via DB (antar-device).
	if active, ok := svc.ActiveSyncJob(ctx, uid, connID); !ok || active != jobID {
		t.Fatalf("active = %q,%v mau %q", active, ok, jobID)
	}

	// Jeda → snapshot paused.
	if err := svc.PauseSyncJob(jobID, uid); err != nil {
		t.Fatalf("pause: %v", err)
	}
	p := waitStatus(t, svc, jobID, uid, "paused", 5*time.Second)
	if p.Status != "paused" {
		t.Fatalf("status=%s", p.Status)
	}

	// Saat dijeda, processed tidak boleh maju.
	n1 := p.Processed
	time.Sleep(600 * time.Millisecond)
	p2, _ := svc.SyncJobProgress(jobID, uid)
	if p2.Processed != n1 && p2.Status == "paused" {
		t.Fatalf("processed maju saat dijeda: %d → %d", n1, p2.Processed)
	}

	// Lanjut → selesai.
	if err := svc.ResumeSyncJob(jobID, uid); err != nil {
		t.Fatalf("resume: %v", err)
	}
	done := waitStatus(t, svc, jobID, uid, "done", 20*time.Second)
	if done.New < 1 {
		t.Fatalf("tidak ada email baru: %+v", done)
	}

	// Baris DB final.
	var status string
	var processed int
	_ = svc.pool.QueryRow(ctx, `SELECT status, processed FROM sync_jobs WHERE id=$1::uuid`, jobID).Scan(&status, &processed)
	if status != "done" || processed < 1 {
		t.Fatalf("db row status=%s processed=%d", status, processed)
	}

	// Tidak lagi aktif.
	if _, ok := svc.ActiveSyncJob(ctx, uid, connID); ok {
		t.Fatal("masih aktif setelah selesai")
	}
}

// TestSyncJobCancel: job yang dibatalkan berhenti.
func TestSyncJobCancel(t *testing.T) {
	svc, uid, connID := setupJobTest(t)
	ctx := context.Background()

	jobID, err := svc.StartSyncJob(ctx, uid, connID, true, 6)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if err := svc.CancelSyncJob(jobID, uid); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	p := waitStatus(t, svc, jobID, uid, "canceled", 10*time.Second)
	if p.Status != "canceled" {
		t.Fatalf("status=%s", p.Status)
	}
}

// TestRecoverStaleJobs: baris tertinggal ditandai error saat startup.
func TestRecoverStaleJobs(t *testing.T) {
	svc, uid, connID := setupJobTest(t)
	ctx := context.Background()

	var id string
	if err := svc.pool.QueryRow(ctx, `INSERT INTO sync_jobs (id, user_id, connection_id, status)
		VALUES (gen_random_uuid(),$1,$2::uuid,'running') RETURNING id::text`, uid, connID).Scan(&id); err != nil {
		t.Fatalf("insert: %v", err)
	}
	n, err := svc.RecoverStaleJobs(ctx)
	if err != nil || n < 1 {
		t.Fatalf("recover n=%d err=%v", n, err)
	}
	var status string
	_ = svc.pool.QueryRow(ctx, `SELECT status FROM sync_jobs WHERE id=$1::uuid`, id).Scan(&status)
	if status != "error" {
		t.Fatalf("status=%s", status)
	}
}
