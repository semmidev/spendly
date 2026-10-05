package extraction

import (
	"testing"

	"github.com/semmidev/spendly/internal/modules/mailsync"
)

// Golden set mini (PLAN §4.6): fallback parser + gate harus lolos CI.
// Kasus: struk, topup, OTP, promo, transfer bank.
type goldenCase struct {
	name         string
	from, subj   string
	text         string
	wantGate     bool // lolos gate?
	wantExpense  bool
	wantAmount   int64 // 0 = abaikan
	wantMerchant string
	wantSource   string // payment_source; "" = abaikan
}

var golden = []goldenCase{
	{
		name: "gopay grab", from: "noreply@gopay.co.id", subj: "Pembayaran berhasil",
		text:     "Kamu membayar Rp 27.500 ke GRAB*TRIP. Saldo GoPay Rp 100.000. Ref TRX/ABC/123",
		wantGate: true, wantExpense: true, wantAmount: 27500, wantMerchant: "Grab", wantSource: "GoPay",
	},
	{
		name: "bca transfer", from: "noreply@bca.co.id", subj: "Transfer berhasil",
		text:     "Transfer Rp1.250.000 ke BCA ****4321 pada 03 Okt 2026 14:22 WIB. No ref 998877",
		wantGate: true, wantExpense: true, wantAmount: 1250000, wantSource: "BCA ****4321",
	},
	{
		name: "tokopedia", from: "noreply@tokopedia.com", subj: "Pesanan dibayar",
		text:     "Pesanan INV/2026/X/99 senilai Rp 349.000,00 lunas via BCA Virtual Account.",
		wantGate: true, wantExpense: true, wantAmount: 349000, wantMerchant: "Tokopedia", wantSource: "BCA Virtual Account",
	},
	{
		name: "topup", from: "noreply@gopay.co.id", subj: "Top up berhasil",
		text:     "Isi saldo GoPay Rp 200.000 dari BCA ****1234 berhasil.",
		wantGate: true, wantExpense: false, wantSource: "GoPay",
	},
	{
		name: "otp", from: "noreply@bca.co.id", subj: "Kode OTP Anda",
		text:     "Kode OTP 482913 berlaku 5 menit. Jangan berikan ke siapa pun.",
		wantGate: false,
	},
	{
		name: "promo", from: "promo@shopee.co.id", subj: "Promo 12.12 diskon 90%",
		text:     "Klaim voucher sekarang, gratis ongkir se-Indonesia!",
		wantGate: false,
	},
}

func TestGoldenGate(t *testing.T) {
	for _, g := range golden {
		pass, _ := mailsync.Gate(g.from, g.subj, g.text)
		if pass != g.wantGate {
			t.Fatalf("%s: gate=%v mau %v", g.name, pass, g.wantGate)
		}
	}
}

func TestGoldenFallback(t *testing.T) {
	for _, g := range golden {
		if !g.wantGate {
			continue
		}
		r := FallbackExtract(g.from, g.subj, g.text)
		if r.IsExpense != g.wantExpense {
			t.Fatalf("%s: is_expense=%v mau %v", g.name, r.IsExpense, g.wantExpense)
		}
		if g.wantAmount > 0 {
			v, ok := ParseAmount(deref(r.AmountRaw))
			if !ok || v != g.wantAmount {
				t.Fatalf("%s: amount=%v,%v mau %d", g.name, deref(r.AmountRaw), ok, g.wantAmount)
			}
		}
		if g.wantMerchant != "" && r.Merchant != g.wantMerchant {
			t.Fatalf("%s: merchant=%q mau %q", g.name, r.Merchant, g.wantMerchant)
		}
		if g.wantSource != "" {
			got := ""
			if r.PaymentSource != nil {
				got = *r.PaymentSource
			}
			if got != g.wantSource {
				t.Fatalf("%s: payment_source=%q mau %q", g.name, got, g.wantSource)
			}
		}
	}
}

func TestDerivePaymentSource(t *testing.T) {
	cases := []struct{ name, from, text, want string }{
		{"domain bank", "noreply@bca.co.id", "Pembayaran berhasil", "BCA"},
		{"domain ewallet", "noreply@gopay.co.id", "Kamu membayar Rp 10.000", "GoPay"},
		{"mask dekat brand", "noreply@bca.co.id", "Transfer ke BCA ****4321 berhasil", "BCA ****4321"},
		{"va di body", "noreply@tokopedia.com", "lunas via BCA Virtual Account", "BCA Virtual Account"},
		{"qris tanpa brand", "no-reply@qris.example.com", "Pembayaran QRIS Rp 18.000", "QRIS"},
		{"tanpa petunjuk", "no-reply@example.com", "Pembayaran berhasil Rp 5.000", ""},
	}
	for _, c := range cases {
		if got := DerivePaymentSource(c.from, c.text); got != c.want {
			t.Fatalf("%s: got %q mau %q", c.name, got, c.want)
		}
	}
}
