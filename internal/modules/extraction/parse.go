package extraction

import (
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// ParseAmount: "1.250.000,00" / "1,250,000.00" / "Rp 125.000" / "125000" → 1250000.
// LLM mengembalikan string persis tercetak; parsing di Go (PLAN §4.2).
func ParseAmount(raw string) (int64, bool) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return 0, false
	}
	// buang simbol mata uang & spasi
	var b strings.Builder
	for _, r := range s {
		if (r >= '0' && r <= '9') || r == '.' || r == ',' || r == '-' {
			b.WriteRune(r)
		}
	}
	s = b.String()
	neg := strings.HasPrefix(s, "-")
	s = strings.TrimPrefix(s, "-")
	if s == "" {
		return 0, false
	}
	lastDot, lastComma := strings.LastIndex(s, "."), strings.LastIndex(s, ",")
	decSep := -1
	switch {
	case lastDot >= 0 && lastComma >= 0:
		// pemisah TERAKHIR = desimal
		if lastDot > lastComma {
			decSep = lastDot
		} else {
			decSep = lastComma
		}
	case lastDot >= 0:
		if isThousandGroups(s, '.') {
			decSep = -1
		} else {
			decSep = lastDot
		}
	case lastComma >= 0:
		if isThousandGroups(s, ',') {
			decSep = -1
		} else {
			decSep = lastComma
		}
	}
	intPart := s
	fracPart := ""
	if decSep >= 0 {
		intPart, fracPart = s[:decSep], s[decSep+1:]
		// desimal > 2 digit → sebenarnya ribuan (mis. "1.250.000" lolos dari atas)
		if len(fracPart) != 2 && len(fracPart) != 0 {
			if decSep == lastDot || decSep == lastComma {
				intPart = s
				fracPart = ""
				decSep = -1
			}
		}
	}
	digits := onlyDigits(intPart)
	if digits == "" {
		return 0, false
	}
	v, err := strconv.ParseInt(digits, 10, 64)
	if err != nil {
		return 0, false
	}
	if decSep >= 0 && len(fracPart) == 2 {
		if f, err := strconv.Atoi(fracPart); err == nil && f > 0 {
			// IDR tanpa sen: bulatkan (bank kadang kirim ,00)
			if f >= 50 {
				v++
			}
		}
	}
	if v <= 0 {
		return 0, false
	}
	if neg {
		v = -v
	}
	_ = math.MaxInt64
	return v, true
}

func isThousandGroups(s string, sep byte) bool {
	parts := strings.Split(s, string(sep))
	if len(parts) < 2 {
		return false
	}
	for i, p := range parts {
		if p == "" {
			return false
		}
		for _, r := range p {
			if r < '0' || r > '9' {
				return false
			}
		}
		if i > 0 && len(p) != 3 {
			return false
		}
	}
	return true
}

var idMonths = map[string]string{
	"jan": "Jan", "feb": "Feb", "mar": "Mar", "apr": "Apr", "mei": "May",
	"jun": "Jun", "jul": "Jul", "agu": "Aug", "sep": "Sep", "okt": "Oct",
	"nov": "Nov", "des": "Dec",
}

var tzOffset = map[string]int{
	"WIB": 7, "WITA": 8, "WIT": 9, "GMT+7": 7, "+0700": 7, "+07:00": 7,
}

// ParseDate: tanggal tercetak → time. Tanpa offset = Asia/Jakarta (PLAN §4.2).
// Tolak: masa depan >24 jam, atau >90 hari lebih tua dari email.
func ParseDate(raw string, emailTime time.Time) (time.Time, bool) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return time.Time{}, false
	}
	norm := normalizeIDDate(s)
	layouts := []string{
		"02 Jan 2006 15:04:05 -0700", "02 Jan 2006 15:04 -0700",
		"02 Jan 2006 15:04:05", "02 Jan 2006 15:04", "02 Jan 2006",
		time.RFC3339, "2006-01-02 15:04:05", "2006-01-02",
		"02/01/2006 15:04", "02/01/2006", "02-01-2006",
	}
	jkt := time.FixedZone("WIB", 7*3600)
	for _, l := range layouts {
		if t, err := time.ParseInLocation(l, norm, jkt); err == nil {
			t = t.In(time.UTC)
			now := time.Now()
			if t.After(now.Add(24 * time.Hour)) {
				return time.Time{}, false
			}
			if !emailTime.IsZero() && t.Before(emailTime.AddDate(0, 0, -90)) {
				return time.Time{}, false
			}
			return t, true
		}
	}
	return time.Time{}, false
}

var idMonthRe = regexp.MustCompile(`(?i)\b(jan|feb|mar|apr|mei|jun|jul|agu|sep|okt|nov|des)\b`)

func normalizeIDDate(s string) string {
	s = idMonthRe.ReplaceAllStringFunc(s, func(m string) string {
		if en, ok := idMonths[strings.ToLower(m)]; ok {
			return en
		}
		return m
	})
	// "03 Okt 2026 14:22 WIB" → offset numerik agar layout -0700 cocok
	for abbr, h := range tzOffset {
		if strings.Contains(s, abbr) {
			s = strings.ReplaceAll(s, abbr, "")
			s = strings.TrimSpace(s) + " +" + pad2(h) + "00"
			break
		}
	}
	return strings.Join(strings.Fields(s), " ")
}

func pad2(h int) string {
	if h < 10 {
		return "0" + strconv.Itoa(h)
	}
	return strconv.Itoa(h)
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
