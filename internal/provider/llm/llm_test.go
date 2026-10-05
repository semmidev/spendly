package llm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const sampleResult = `{"is_expense":true,"kind":"purchase","amount_raw":"Rp 27.500",` +
	`"currency":"IDR","merchant":"Grab","occurred_at_raw":"05 Okt 2026 10:00 WIB",` +
	`"reference_no":"REF1","category":"Transport","confidence":0.9,"reason":"struk"}`

// Mode chat: POST /chat/completions + response_format json_schema.
func TestExtractChat(t *testing.T) {
	var gotPath string
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&body)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "1", "object": "chat.completion", "model": "m",
			"choices": []map[string]any{{"index": 0, "finish_reason": "stop",
				"message": map[string]any{"role": "assistant", "content": sampleResult}}},
			"usage": map[string]any{"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
		})
	}))
	defer srv.Close()

	c := New("key", srv.URL, "gpt-4o-mini", "chat")
	res, u, err := c.Extract(context.Background(), "email teks", []string{"Transport"})
	if err != nil {
		t.Fatalf("extract: %v", err)
	}
	if gotPath != "/chat/completions" {
		t.Fatalf("path=%s", gotPath)
	}
	if rf, _ := body["response_format"].(map[string]any); rf["type"] != "json_schema" {
		t.Fatalf("response_format bukan json_schema: %v", body["response_format"])
	}
	if !res.IsExpense || res.Merchant != "Grab" || res.AmountRaw == nil || *res.AmountRaw != "Rp 27.500" {
		t.Fatalf("hasil salah: %+v", res)
	}
	if u.TokensIn != 10 || u.TokensOut != 5 {
		t.Fatalf("usage salah: %+v", u)
	}
}

// Mode responses: POST /responses + text.format json_schema (Zen muse-spark).
func TestExtractResponses(t *testing.T) {
	var gotPath string
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&body)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "r1", "object": "response", "model": "muse-spark-1.3-contributor-free", "status": "completed",
			"output": []map[string]any{{"type": "message", "role": "assistant",
				"content": []map[string]any{{"type": "output_text", "text": "```json\n" + sampleResult + "\n```"}}}},
			"usage": map[string]any{"input_tokens": 12, "output_tokens": 6, "total_tokens": 18},
		})
	}))
	defer srv.Close()

	c := New("key", srv.URL, "muse-spark-1.3-contributor-free", "responses")
	res, u, err := c.Extract(context.Background(), "email teks", []string{"Transport"})
	if err != nil {
		t.Fatalf("extract: %v", err)
	}
	if gotPath != "/responses" {
		t.Fatalf("path=%s", gotPath)
	}
	text, _ := body["text"].(map[string]any)
	format, _ := text["format"].(map[string]any)
	if format["type"] != "json_schema" {
		t.Fatalf("text.format bukan json_schema: %v", body["text"])
	}
	if !res.IsExpense || res.Merchant != "Grab" {
		t.Fatalf("hasil salah: %+v", res)
	}
	if u.TokensIn != 12 || u.TokensOut != 6 {
		t.Fatalf("usage salah: %+v", u)
	}
}

func TestParseResultToleranPagar(t *testing.T) {
	res, err := parseResult("Berikut hasilnya:\n```json\n" + sampleResult + "\n```")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if res.Merchant != "Grab" {
		t.Fatalf("merchant=%s", res.Merchant)
	}
	if _, err := parseResult("bukan json"); err == nil {
		t.Fatal("harus gagal untuk non-JSON")
	}
}

func TestCostFreeModelNol(t *testing.T) {
	if c := costOf("muse-spark-1.3-contributor-free", 100000, 100000); c != 0 {
		t.Fatalf("model free harus 0, dapat %v", c)
	}
	if !strings.Contains(joinCats(nil), "Makanan") {
		t.Fatal("kategori default hilang")
	}
}
