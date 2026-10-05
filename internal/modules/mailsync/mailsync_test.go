package mailsync

import (
	"encoding/base64"
	"strings"
	"testing"
	"time"

	gmailapi "google.golang.org/api/gmail/v1"
)

func msgWith(t *testing.T, mime, data string, headers ...*gmailapi.MessagePartHeader) *gmailapi.Message {
	t.Helper()
	return &gmailapi.Message{
		Payload: &gmailapi.MessagePart{
			MimeType: mime,
			Body:     &gmailapi.MessagePartBody{Data: data},
			Headers:  headers,
		},
	}
}

// "halo" dalam base64url.
func TestCleanPrefersPlain(t *testing.T) {
	m := &gmailapi.Message{
		Payload: &gmailapi.MessagePart{
			MimeType: "multipart/alternative",
			Parts: []*gmailapi.MessagePart{
				{MimeType: "text/plain", Body: &gmailapi.MessagePartBody{Data: "aGFsbw"}},
				{MimeType: "text/html", Body: &gmailapi.MessagePartBody{Data: "PGI+aGFsbw=="}},
			},
			Headers: []*gmailapi.MessagePartHeader{{Name: "Subject", Value: "Struk"}},
		},
	}
	c := CleanMessage(m)
	if c.Text != "halo" {
		t.Fatalf("got %q", c.Text)
	}
}

func TestCleanHTMLTable(t *testing.T) {
	raw := `<table><tr><td>Total</td><td>Rp125.000</td></tr></table>`
	enc := strings.TrimRight(base64.URLEncoding.EncodeToString([]byte(raw)), "=")
	m := msgWith(t, "text/html", enc)
	c := CleanMessage(m)
	if !strings.Contains(c.Text, "Rp125.000") || !strings.Contains(c.Text, "Total") {
		t.Fatalf("tabel hilang: %q", c.Text)
	}
	if strings.Contains(c.Text, "<td>") {
		t.Fatalf("tag bocor: %q", c.Text)
	}
}

func TestGateOTP(t *testing.T) {
	if pass, _ := Gate("bank@bca.co.id", "Kode OTP Anda", "Kode OTP 482913 berlaku 5 menit"); pass {
		t.Fatal("OTP harus dibuang")
	}
}

func TestGatePromo(t *testing.T) {
	if pass, _ := Gate("promo@tokopedia.com", "Promo 12.12 diskon 90%", "klik di sini"); pass {
		t.Fatal("promo harus dibuang")
	}
}

func TestGateTxPass(t *testing.T) {
	pass, _ := Gate("noreply@tokopedia.com", "Pembayaran berhasil", "Pesanan Rp125.000 lunas via GoPay")
	if !pass {
		t.Fatal("struk harus lolos")
	}
}

func TestRedact(t *testing.T) {
	out := Redact("Kartu 4111 1111 1111 1234, hub 081234567890, kode OTP 482913")
	if strings.Contains(out, "4111 1111") {
		t.Fatalf("kartu bocor: %q", out)
	}
	if !strings.Contains(out, "1234") {
		t.Fatalf("4 digit terakhir hilang: %q", out)
	}
	if strings.Contains(out, "081234567890") {
		t.Fatalf("telepon bocor: %q", out)
	}
	if strings.Contains(out, "482913") {
		t.Fatalf("OTP bocor: %q", out)
	}
}

func TestSenderDomain(t *testing.T) {
	for in, want := range map[string]string{
		"Bank BCA <noreply@bca.co.id>": "bca.co.id",
		"gopay@gopay.co.id":            "gopay.co.id",
	} {
		if got := senderDomain(in); got != want {
			t.Fatalf("%q → %q, mau %q", in, got, want)
		}
	}
}

func TestBuildQueryBefore(t *testing.T) {
	after := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	got := buildQuery([]string{"bca.co.id", "gopay.co.id"}, after, time.Time{})
	if !strings.Contains(got, "after:") || strings.Contains(got, "before:") {
		t.Fatalf("tanpa before: %q", got)
	}
	before := time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)
	got = buildQuery([]string{"bca.co.id"}, after, before)
	if !strings.Contains(got, "from:(bca.co.id)") || !strings.Contains(got, "after:") || !strings.Contains(got, "before:") {
		t.Fatalf("dengan before: %q", got)
	}
}
