package mailsync

import (
	"regexp"
	"strings"
)

// Redaksi sebelum teks dikirim ke AI (PLAN §4.4).

var (
	cardRe  = regexp.MustCompile(`\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{3,4}\b`)
	longRe  = regexp.MustCompile(`\b\d{10,}\b`)
	phoneRe = regexp.MustCompile(`(\+62|62|0)8\d{7,11}`)
	otpRe   = regexp.MustCompile(`(?i)(otp|verifikasi|verification|security code|kode keamanan)[^\d]{0,20}(\d{4,8})`)
	emailRe = regexp.MustCompile(`[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}`)
)

func Redact(text string) string {
	text = cardRe.ReplaceAllStringFunc(text, func(m string) string {
		digits := onlyDigits(m)
		if len(digits) < 4 {
			return "****"
		}
		return "**** **** **** " + digits[len(digits)-4:]
	})
	text = phoneRe.ReplaceAllString(text, "[TELEPON]")
	text = otpRe.ReplaceAllString(text, "$1 [OTP]")
	text = emailRe.ReplaceAllStringFunc(text, func(m string) string {
		if i := strings.Index(m, "@"); i > 0 {
			return "***" + m[i:]
		}
		return "[EMAIL]"
	})
	// sisa digit panjang (rekening dsb): sisakan 4 terakhir
	text = longRe.ReplaceAllStringFunc(text, func(m string) string {
		d := onlyDigits(m)
		if len(d) <= 6 {
			return m
		}
		return d[:2] + "***" + d[len(d)-4:]
	})
	return text
}

func onlyDigits(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}
