package mailsync

import (
	"context"
	"encoding/base64"
	"strings"
	"testing"
	"time"

	gmailapi "google.golang.org/api/gmail/v1"
)

// senderFilterStub: From berbeda per ID + mencatat Get (body) vs
// GetMetadata (header saja) per ID.
type senderFilterStub struct {
	from    map[string]string
	getIDs  []string
	metaIDs []string
}

func (s *senderFilterStub) ListIDs(ctx context.Context, query, pageToken string) ([]string, string, error) {
	ids := make([]string, 0, len(s.from))
	for id := range s.from {
		ids = append(ids, id)
	}
	return ids, "", nil
}

func (s *senderFilterStub) headers(from string) []*gmailapi.MessagePartHeader {
	return []*gmailapi.MessagePartHeader{
		{Name: "From", Value: from},
		{Name: "Subject", Value: "Transaksi Berhasil"},
	}
}

func (s *senderFilterStub) Get(ctx context.Context, id string) (*gmailapi.Message, error) {
	s.getIDs = append(s.getIDs, id)
	text := "Pembayaran Rp125.000 berhasil. Ref FILTER1."
	data := strings.TrimRight(base64.URLEncoding.EncodeToString([]byte(text)), "=")
	return &gmailapi.Message{
		Id:           id,
		InternalDate: time.Now().UnixMilli(),
		Payload: &gmailapi.MessagePart{
			MimeType: "text/plain",
			Body:     &gmailapi.MessagePartBody{Data: data},
			Headers:  s.headers(s.from[id]),
		},
	}, nil
}

func (s *senderFilterStub) GetMetadata(ctx context.Context, id string) (*gmailapi.Message, error) {
	s.metaIDs = append(s.metaIDs, id)
	return &gmailapi.Message{
		Id:      id,
		Payload: &gmailapi.MessagePart{Headers: s.headers(s.from[id])},
	}, nil
}

func (s *senderFilterStub) HistoryIDNow(ctx context.Context) (uint64, error) { return 999, nil }

func (s *senderFilterStub) HistoryAdded(ctx context.Context, historyID uint64) ([]string, uint64, bool, error) {
	return nil, 999, false, nil
}

// TestUncheckedSenderNeverStoredNorDownloaded: email dari pengirim yang tidak
// dicentang tidak boleh tersimpan, dan body-nya tidak boleh diunduh
// (Get tidak dipanggil untuknya — cukup GetMetadata).
func TestUncheckedSenderNeverStoredNorDownloaded(t *testing.T) {
	svc, _, connID := setupJobTest(t)
	ctx := context.Background()
	stub := &senderFilterStub{from: map[string]string{
		"m-ok":   "Bank BCA <noreply@bca.co.id>",
		"m-evil": "Promo <promo@evil.com>",
	}}
	allowed := map[string]bool{"bca.co.id": true}
	nogate := func() error { return nil }
	noreport := func(Progress) {}
	st, err := svc.backfill(ctx, stub, connID, allowed, time.Now().AddDate(0, 0, -7), time.Time{}, 10, nogate, noreport)
	if err != nil {
		t.Fatalf("backfill: %v", err)
	}
	if st.New != 1 {
		t.Fatalf("baru=%d mau 1 (hanya pengirim dicentang)", st.New)
	}
	var n int
	var onlyID string
	_ = svc.pool.QueryRow(ctx, `SELECT COUNT(*), MAX(gmail_message_id) FROM raw_emails WHERE connection_id=$1::uuid`,
		connID).Scan(&n, &onlyID)
	if n != 1 || onlyID != "m-ok" {
		t.Fatalf("tersimpan n=%d id=%q, mau 1/m-ok", n, onlyID)
	}
	for _, id := range stub.getIDs {
		if id == "m-evil" {
			t.Fatal("body email pengirim tak dicentang ikut diunduh (Get dipanggil)")
		}
	}
	found := false
	for _, id := range stub.metaIDs {
		if id == "m-evil" {
			found = true
		}
	}
	if !found {
		t.Fatal("filter metadata tidak jalan untuk m-evil")
	}
}
