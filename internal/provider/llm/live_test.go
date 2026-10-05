package llm

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/joho/godotenv"
)

// TestExtractLive memanggil provider AI sungguhan memakai .env.
// Di-skip bila AI_API_KEY kosong atau provider menolak (mis. saldo habis).
func TestExtractLive(t *testing.T) {
	_ = godotenv.Load("../../../.env")
	key := os.Getenv("AI_API_KEY")
	if key == "" {
		t.Skip("AI_API_KEY tidak diset")
	}
	base := os.Getenv("AI_BASE_URL")
	model := os.Getenv("AI_MODEL")
	mode := os.Getenv("AI_API_MODE")

	c := New(key, base, model, mode)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	email := "From: noreply@gopay.co.id\nPembayaran berhasil. Kamu membayar Rp 27.500 ke GRAB*TRIP " +
		"pada 05 Okt 2026 10:00 WIB. Ref TRX/ABC/123. Saldo GoPay Rp 100.000."
	res, u, err := c.Extract(ctx, email, []string{"Makanan", "Transport", "Belanja", "Tagihan", "Lainnya"})
	if err != nil {
		t.Skipf("provider menolak (kredensial/saldo?): %v", err)
	}
	if !res.IsExpense {
		t.Fatalf("is_expense=false, hasil: %+v", res)
	}
	if res.AmountRaw == nil || !strings.Contains(*res.AmountRaw, "27.500") {
		t.Fatalf("amount_raw salah: %+v", res.AmountRaw)
	}
	t.Logf("OK model=%s tokens=%d/%d cost=%.6f merchant=%q kind=%s",
		model, u.TokensIn, u.TokensOut, u.Cost, res.Merchant, res.Kind)
}
