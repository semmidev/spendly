package extraction

import (
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/semmidev/spendly/internal/provider/llm"
)

var (
	rpRe    = regexp.MustCompile(`(?i)rp\.?\s?([\d.,]+)`)
	numRe   = regexp.MustCompile(`\b\d[\d.,]*\b`)
	topupRe = regexp.MustCompile(`(?i)(top[\s-]?up|isi saldo|saldo masuk|deposit)`)
	refRe   = regexp.MustCompile(`(?i)(?:no\.?\s?(?:ref|transaksi|order|resi)|ref[:\s]|trxid|id transaksi)[:\s]*([A-Za-z0-9/\-]{5,40})`)
	catKw   = []struct {
		cat string
		kws []string
	}{
		{"Makanan", []string{"gofood", "grabfood", "shopeefood", "restoran", "resto", "kopi", "kafe", "makan", "warung"}},
		{"Transport", []string{"grab", "gojek", "gocar", "grabbike", "bensin", "tol", "parkir", "kereta", "tiket pesawat", "traveloka"}},
		{"Belanja", []string{"tokopedia", "shopee", "order", "pesanan", "marketplace"}},
		{"Tagihan", []string{"pln", "listrik", "pdam", "bpjs", "internet", "pulsa", "tagihan"}},
		{"Hiburan", []string{"netflix", "spotify", "bioskop", "game", "steam"}},
		{"Kesehatan", []string{"apotek", "rs ", "rumah sakit", "klinik", "halodoc"}},
		{"Transfer", []string{"transfer", "kirim dana", "qr is"}},
	}
	domainMerchant = map[string]string{
		"tokopedia.com": "Tokopedia", "shopee.co.id": "Shopee", "grab.com": "Grab",
		"gojek.com": "Gojek", "gopay.co.id": "GoPay", "ovo.id": "OVO", "dana.id": "DANA",
		"traveloka.com": "Traveloka", "bca.co.id": "BCA", "bankmandiri.co.id": "Mandiri",
		"bni.co.id": "BNI", "bri.co.id": "BRI", "jago.com": "Jago", "seabank.co.id": "SeaBank",
	}

	// payment_source: bank/e-wallet. Diprioritaskan dari domain pengirim.
	sourceDomains = map[string]string{
		"bca.co.id": "BCA", "bankmandiri.co.id": "Mandiri", "bni.co.id": "BNI",
		"bri.co.id": "BRI", "jago.com": "Jago", "seabank.co.id": "SeaBank",
		"gopay.co.id": "GoPay", "ovo.id": "OVO", "dana.id": "DANA",
		"shopeepay.co.id": "ShopeePay", "jenius.com": "Jenius",
	}
	sourceTextOrder = []struct {
		brand string
		re    *regexp.Regexp
	}{
		{"BCA", regexp.MustCompile(`(?i)\bbca\b`)},
		{"Mandiri", regexp.MustCompile(`(?i)\bmandiri\b`)},
		{"BNI", regexp.MustCompile(`(?i)\bbni\b`)},
		{"BRI", regexp.MustCompile(`(?i)\bbri\b`)},
		{"Jago", regexp.MustCompile(`(?i)\bjago\b`)},
		{"SeaBank", regexp.MustCompile(`(?i)\bseabank\b`)},
		{"GoPay", regexp.MustCompile(`(?i)\bgopay\b`)},
		{"OVO", regexp.MustCompile(`(?i)\bovo\b`)},
		{"DANA", regexp.MustCompile(`(?i)\bdana\b`)},
		{"ShopeePay", regexp.MustCompile(`(?i)\bshopeepay\b`)},
		{"Jenius", regexp.MustCompile(`(?i)\bjenius\b`)},
	}
	maskRe = regexp.MustCompile(`\*{2,}\s?(\d{3,4})`)
)

// FallbackExtract: parser deterministik tanpa AI (hemat biaya; dipakai bila
// tanpa API key atau eskalasi gagal). Confidence rendah → review queue.
func FallbackExtract(from, subject, text string) llm.Result {
	s := func(v string) *string { return &v }
	joined := subject + "\n" + text
	low := strings.ToLower(joined)

	kind := "purchase"
	if topupRe.MatchString(low) {
		kind = "topup_own"
	}
	r := llm.Result{Kind: kind, Currency: "IDR", Confidence: 0.55, Reason: "parser deterministik tanpa AI"}

	// nominal: Rp pertama pada baris berbau pembayaran (bayar/total/lunas);
	// fallback Rp pertama. Jangan ambil terbesar (saldo sering lebih besar).
	best := pickAmount(joined)
	if best > 0 {
		amt := formatRaw(best)
		r.AmountRaw = &amt
	}
	r.Merchant = guessMerchant(from, low)
	if ps := DerivePaymentSource(from, joined); ps != "" {
		r.PaymentSource = &ps
	}
	if m := refRe.FindStringSubmatch(joined); m != nil {
		ref := strings.Trim(m[1], ":-/. ")
		r.ReferenceNo = &ref
	}
	if cat := guessCategory(low); cat != "" {
		r.Category = s(cat)
	}
	// note deskriptif sederhana (AI mengisi versi lebih kaya bila tersedia)
	if r.Merchant != "" {
		note := "Pembayaran di " + r.Merchant
		if r.Category != nil && *r.Category != "" {
			note = *r.Category + " di " + r.Merchant
		}
		r.Note = &note
	}
	r.IsExpense = kind == "purchase" || kind == "transfer_out"
	if r.IsExpense && best == 0 {
		r.Confidence = 0.3
	}
	now := time.Now().Format("02 Jan 2006 15:04")
	r.OccurredAtRaw = &now
	return r
}

var payLineRe = regexp.MustCompile(`(?i)(bayar|membayar|total|sebesar|senilai|lunas|tagihan|transfer|nominal|amount)`)

func pickAmount(joined string) int64 {
	first := func(s string) int64 {
		for _, m := range rpRe.FindAllStringSubmatch(s, -1) {
			if v, ok := ParseAmount(m[1]); ok && v > 0 && v < 1_000_000_000_000 {
				return v
			}
		}
		return 0
	}
	for _, line := range strings.Split(joined, "\n") {
		if payLineRe.MatchString(line) {
			if v := first(line); v > 0 {
				return v
			}
		}
	}
	if v := first(joined); v > 0 {
		return v
	}
	for _, m := range numRe.FindAllString(joined, -1) {
		if v, ok := ParseAmount(m); ok && v >= 1000 && v < 1_000_000_000_000 {
			return v
		}
	}
	return 0
}

func guessMerchant(from, low string) string {
	dom := domainOf(from)
	if m, ok := domainMerchant[dom]; ok {
		// bila teks menyebut brand lain yang lebih spesifik, pakai itu
		for _, cand := range []string{"Grab", "Gojek", "GoPay", "OVO", "DANA", "Shopee", "Tokopedia", "Traveloka"} {
			if strings.Contains(low, strings.ToLower(cand)) {
				return cand
			}
		}
		return m
	}
	return dom
}

// domainOf: "Nama <a@bca.co.id>" → "bca.co.id".
func domainOf(from string) string {
	if i := strings.LastIndex(from, "@"); i >= 0 {
		return strings.ToLower(strings.Trim(from[i+1:], " >\"',;)"))
	}
	return strings.ToLower(strings.TrimSpace(from))
}

// DerivePaymentSource menebak sumber pembayaran: domain bank/e-wallet pengirim
// lebih diprioritaskan, lalu brand dari isi email, plus nomor termask / VA.
// Mengembalikan "" bila tidak ada petunjuk (biar jadi null).
func DerivePaymentSource(from, text string) string {
	low := strings.ToLower(text)
	brand := sourceDomains[domainOf(from)]
	if brand == "" {
		brand = sourceBrandFromText(low)
	}
	if brand == "" {
		if !strings.Contains(low, "qris") {
			return ""
		}
		brand = "QRIS"
	}
	if suffix := sourceWithMask(text, brand); suffix != "" {
		return brand + suffix
	}
	if strings.Contains(low, "virtual account") {
		return brand + " Virtual Account"
	}
	return brand
}

// sourceWithMask melampirkan nomor termask (mis. "****4321") hanya bila brand
// muncul dekat nomor tersebut — hindari salah tempel antar instrumen.
func sourceWithMask(text, brand string) string {
	loc := maskRe.FindStringSubmatchIndex(text)
	if loc == nil || loc[2] < 0 {
		return ""
	}
	start := loc[0] - 20
	if start < 0 {
		start = 0
	}
	if !strings.Contains(strings.ToLower(text[start:loc[0]]), strings.ToLower(brand)) {
		return ""
	}
	return " ****" + text[loc[2]:loc[3]]
}

func sourceBrandFromText(low string) string {
	for _, s := range sourceTextOrder {
		if s.re.MatchString(low) {
			return s.brand
		}
	}
	return ""
}

func guessCategory(low string) string {
	for _, c := range catKw {
		for _, k := range c.kws {
			if strings.Contains(low, k) {
				return c.cat
			}
		}
	}
	return ""
}

func formatRaw(v int64) string {
	s := strconv.FormatInt(v, 10)
	n := len(s)
	var out []byte
	for i := 0; i < n; i++ {
		if i > 0 && (n-i)%3 == 0 {
			out = append(out, '.')
		}
		out = append(out, s[i])
	}
	return "Rp " + string(out)
}
