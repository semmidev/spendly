package mailsync

import (
	"bytes"
	"encoding/base64"
	"io"
	"mime/quotedprintable"
	"strings"
	"time"

	"golang.org/x/net/html"
	"golang.org/x/text/encoding/charmap"
	gmailapi "google.golang.org/api/gmail/v1"
)

// Cleaned: teks bersih + header penting. Body mentah TIDAK disimpan (PLAN §7).
type Cleaned struct {
	Text         string
	From         string
	Subject      string
	Date         string
	MessageID    string
	InternalDate time.Time
}

// CleanMessage: telusuri MIME tree (text/plain dulu, else text/html),
// decode base64url + charset + quoted-printable, HTML→teks (tabel dipertahankan).
func CleanMessage(msg *gmailapi.Message) Cleaned {
	c := Cleaned{}
	if msg == nil {
		return c
	}
	for _, h := range msg.Payload.Headers {
		switch strings.ToLower(h.Name) {
		case "from":
			c.From = h.Value
		case "subject":
			c.Subject = h.Value
		case "date":
			c.Date = h.Value
		case "message-id":
			c.MessageID = h.Value
		}
	}
	if msg.InternalDate > 0 {
		c.InternalDate = time.UnixMilli(msg.InternalDate)
	}
	if plain, ok := findPart(msg.Payload, "text/plain"); ok {
		c.Text = strings.TrimSpace(decodePart(plain))
		if c.Text != "" {
			return c
		}
	}
	if htm, ok := findPart(msg.Payload, "text/html"); ok {
		c.Text = strings.TrimSpace(htmlToText(decodePart(htm)))
	}
	return c
}

func findPart(p *gmailapi.MessagePart, mime string) (*gmailapi.MessagePart, bool) {
	if p == nil {
		return nil, false
	}
	if strings.HasPrefix(p.MimeType, mime) && p.Body != nil && p.Body.Data != "" {
		return p, true
	}
	for _, sub := range p.Parts {
		if f, ok := findPart(sub, mime); ok {
			return f, true
		}
	}
	return nil, false
}

func decodePart(p *gmailapi.MessagePart) string {
	raw := b64url(p.Body.Data)
	if raw == nil {
		return ""
	}
	// quoted-printable?
	ct := ""
	for _, h := range p.Headers {
		if strings.EqualFold(h.Name, "Content-Type") {
			ct = strings.ToLower(h.Value)
		}
		if strings.EqualFold(h.Name, "Content-Transfer-Encoding") && strings.Contains(strings.ToLower(h.Value), "quoted-printable") {
			if dec, err := io.ReadAll(quotedprintable.NewReader(bytes.NewReader(raw))); err == nil {
				raw = dec
			}
		}
	}
	if strings.Contains(ct, "iso-8859-1") || strings.Contains(ct, "windows-1252") || strings.Contains(ct, "latin1") {
		if dec, err := charmap.Windows1252.NewDecoder().Bytes(raw); err == nil {
			return string(dec)
		}
	}
	return string(raw)
}

func b64url(s string) []byte {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	if m := len(s) % 4; m != 0 {
		s += strings.Repeat("=", 4-m)
	}
	b, err := base64.URLEncoding.DecodeString(s)
	if err != nil {
		return nil
	}
	return b
}

// htmlToText: buang script/style/img, pertahankan struktur tabel & blok.
func htmlToText(s string) string {
	doc, err := html.Parse(strings.NewReader(s))
	if err != nil {
		return stripTags(s)
	}
	var b strings.Builder
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode {
			switch n.Data {
			case "script", "style", "head", "noscript":
				return
			case "br":
				b.WriteString("\n")
				return
			case "tr":
				b.WriteString("\n")
			case "td", "th":
				b.WriteString(" | ")
			case "p", "div", "li", "h1", "h2", "h3", "h4", "table":
				b.WriteString("\n")
			}
		}
		if n.Type == html.TextNode {
			t := strings.TrimSpace(n.Data)
			if t != "" {
				b.WriteString(t + " ")
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
		if n.Type == html.ElementNode {
			switch n.Data {
			case "p", "div", "li", "h1", "h2", "h3", "h4", "tr", "table":
				b.WriteString("\n")
			}
		}
	}
	walk(doc)
	// rapikan baris kosong berlebih
	lines := strings.Split(b.String(), "\n")
	var out []string
	for _, l := range lines {
		if t := strings.TrimSpace(strings.Join(strings.Fields(l), " ")); t != "" {
			out = append(out, t)
		}
	}
	return strings.Join(out, "\n")
}

func stripTags(s string) string {
	var b strings.Builder
	in := false
	for _, r := range s {
		switch {
		case r == '<':
			in = true
		case r == '>':
			in = false
		case !in:
			b.WriteRune(r)
		}
	}
	return b.String()
}
