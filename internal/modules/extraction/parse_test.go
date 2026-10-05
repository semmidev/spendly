package extraction

import (
	"testing"
	"time"
)

func TestParseAmount(t *testing.T) {
	for in, want := range map[string]int64{
		"Rp 125.000":       125000,
		"1.250.000,00":     1250000,
		"1,250,000.00":     1250000,
		"IDR 50.000":       50000,
		"125000":           125000,
		"Rp2.500":          2500,
		"Total: Rp 75.500": 75500,
	} {
		got, ok := ParseAmount(in)
		if !ok || got != want {
			t.Fatalf("%q → %d,%v mau %d", in, got, ok, want)
		}
	}
	for _, bad := range []string{"", "gratis", "-"} {
		if _, ok := ParseAmount(bad); ok {
			t.Fatalf("%q seharusnya gagal", bad)
		}
	}
}

func TestParseDate(t *testing.T) {
	email := time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC)
	got, ok := ParseDate("03 Okt 2026 14:22 WIB", email)
	if !ok {
		t.Fatal("tanggal ID gagal diparse")
	}
	if got.Hour() != 7 || got.Day() != 3 { // 14:22+07 → 07:22 UTC
		t.Fatalf("zona salah: %v", got)
	}
	if _, ok := ParseDate("03 Okt 2030 14:22 WIB", email); ok {
		t.Fatal("masa depan harus ditolak")
	}
	if _, ok := ParseDate("03 Jan 2020 14:22 WIB", email); ok {
		t.Fatal("terlalu lama harus ditolak")
	}
}
