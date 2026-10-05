package mailsync

import (
	"regexp"
	"strings"
)

// Gerbang awal tanpa AI (PLAN §3.3/§4.5): OTP tidak pernah ke AI, promo &
// newsletter dibuang hemat biaya. Return lolos=false + alasan bila dibuang.

var (
	otpWords   = []string{"kode otp", "kode verifikasi", "verification code", "one-time", "one time", "kode keamanan", "security code"}
	promoWords = []string{"promo", "diskon", "voucher", "newsletter", "unsubscribe", "berhenti berlangganan", "% off", "flash sale", "cashback besar", "kupon", "giveaway", "undian", "lowongan", "job vacancy"}
	txWords    = []string{"berhasil", "struk", "transaksi", "pembayaran", "bukti", "receipt", "payment successful", "paid", "tagihan", "invoice", "order", "pesanan", "transfer", "top up", "topup", "saldo", "mutasi", "debet", "kredit"}
	otpCodeRe  = regexp.MustCompile(`\b\d{4,8}\b`)
)

func Gate(from, subject, text string) (pass bool, reason string) {
	s := strings.ToLower(subject + "\n" + from)
	t := strings.ToLower(text)

	for _, w := range otpWords {
		if strings.Contains(s, w) || strings.Contains(t, w) {
			if otpCodeRe.MatchString(t) || strings.Contains(s, w) {
				return false, "otp"
			}
		}
	}
	for _, w := range promoWords {
		if strings.Contains(s, w) {
			// promo murni (bukan struk yang kebetulan sebut diskon kecil) → buang
			if !containsAny(s, txWords) {
				return false, "promo"
			}
		}
	}
	if looksNewsletter(from, subject) {
		return false, "newsletter"
	}
	return true, ""
}

func looksNewsletter(from, subject string) bool {
	f := strings.ToLower(from)
	if strings.Contains(f, "newsletter") || strings.Contains(f, "noreply-promo") || strings.Contains(f, "marketing@") {
		if !containsAny(strings.ToLower(subject), txWords) {
			return true
		}
	}
	return false
}

func containsAny(s string, words []string) bool {
	for _, w := range words {
		if strings.Contains(s, w) {
			return true
		}
	}
	return false
}
