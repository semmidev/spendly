package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	openai "github.com/sashabaranov/go-openai"
)

// Result: satu panggilan klasifikasi + ekstraksi (PLAN §4.1).
type Result struct {
	IsExpense     bool    `json:"is_expense"`
	Kind          string  `json:"kind"`
	AmountRaw     *string `json:"amount_raw"`
	Currency      string  `json:"currency"`
	Merchant      string  `json:"merchant"`
	OccurredAtRaw *string `json:"occurred_at_raw"`
	PaymentSource *string `json:"payment_source"`
	ReferenceNo   *string `json:"reference_no"`
	Category      *string `json:"category"`
	Note          *string `json:"note"`
	Confidence    float64 `json:"confidence"`
	Reason        string  `json:"reason"`
}

type Usage struct {
	TokensIn  int
	TokensOut int
	Cost      float64
	LatencyMs int
	Model     string
}

const promptVersion = "v1"

// Client membungkus go-openai (OpenAI-compatible: OpenAI, OpenRouter, Zen, dll).
// Dua mode transport:
//   - "chat"      → POST /chat/completions + response_format json_schema
//   - "responses" → POST /responses + text.format json_schema (Zen muse-spark)
type Client struct {
	c         *openai.Client
	model     string
	mode      string
	useSchema bool // json_schema (OpenAI) vs json_object (Zen/deepseek)
}

func New(apiKey, baseURL, model, mode string) *Client {
	cfg := openai.DefaultConfig(apiKey)
	if baseURL != "" {
		cfg.BaseURL = strings.TrimRight(baseURL, "/")
	}
	// OpenCode Go/Zen butuh identitas client + session stabil agar request
	// dirutekan (lihat https://opencode.ai/docs/go/#where-can-i-use-it).
	headers := map[string]string{"User-Agent": "spendly/0.1.0"}
	if strings.Contains(cfg.BaseURL, "opencode.ai") {
		headers["x-opencode-session"] = uuid.NewString()
	}
	cfg.HTTPClient = &http.Client{
		Timeout:   90 * time.Second,
		Transport: &headerTransport{base: http.DefaultTransport, headers: headers},
	}
	if model == "" {
		model = "gpt-4o-mini"
	}
	if mode != "responses" {
		mode = "chat"
	}
	// Zen (deepseek/muse) menolak json_schema di /chat/completions → pakai json_object.
	useSchema := !strings.Contains(cfg.BaseURL, "opencode.ai")
	return &Client{c: openai.NewClientWithConfig(cfg), model: model, mode: mode, useSchema: useSchema}
}

// headerTransport menyuntik header tetap (User-Agent, session) ke setiap request.
type headerTransport struct {
	base    http.RoundTripper
	headers map[string]string
}

func (t *headerTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	r := req.Clone(req.Context())
	for k, v := range t.headers {
		if r.Header.Get(k) == "" {
			r.Header.Set(k, v)
		}
	}
	return t.base.RoundTrip(r)
}

// per-1K token USD (kasar, cukup untuk budget tracking PLAN §4.5).
// Model tak dikenal (mis. contributor-free) dihitung 0.
var pricePer1K = map[string][2]float64{
	"gpt-4o-mini":         {0.00015, 0.0006},
	"gpt-4o":              {0.0025, 0.01},
	"gpt-4.1-mini":        {0.0004, 0.0016},
	"gpt-4.1":             {0.002, 0.008},
	"o4-mini":             {0.0011, 0.0044},
	"deepseek-v4.1-flash": {0.00015, 0.0006},
	"deepseek-v4-flash":   {0.00015, 0.0006},
	"muse-spark-1.3":      {0.0, 0.0},
	"muse-spark-1.2":      {0.0, 0.0},
}

func costOf(model string, in, out int) float64 {
	base := model
	for k := range pricePer1K {
		if strings.HasPrefix(model, k) {
			base = k
			break
		}
	}
	p := pricePer1K[base]
	return float64(in)/1000*p[0] + float64(out)/1000*p[1]
}

const systemPrompt = `Kamu mengekstrak data pengeluaran dari teks email transaksi Indonesia.
Aturan:
- is_expense=true HANYA untuk uang keluar untuk belanja/bayar/transfer ke orang lain (kind purchase atau transfer_out).
- kind: purchase | transfer_out | topup_own | refund | income | other.
- topup_own = isi saldo e-wallet/rekening SENDIRI. income/refund/other → is_expense=false.
- amount_raw/merchant/occurred_at_raw: salin PERSIS seperti tercetak. Tidak jelas → null, JANGAN menebak.
- occurred_at_raw: tanggal+waktu transaksi (bukan tanggal email bila beda).
- category: pilih dari daftar yang diberikan; tidak yakin → null.
- note: deskripsi singkat pengeluaran dalam Bahasa Indonesia, jelaskan untuk apa / beli apa
  (mis. "Perjalanan Grab ke kantor", "Makan siang", "Beli pulsa", "Langganan Netflix").
  Maksimal 60 karakter. Tidak jelas → null.
- confidence 0..1; di bawah 0.7 bila ragu.
- reason: satu kalimat Bahasa Indonesia.
Balas HANYA JSON objek sesuai field di atas, tanpa penjelasan tambahan.`

const resultSchemaJSON = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "is_expense": {"type": "boolean"},
    "kind": {"type": "string", "enum": ["purchase","transfer_out","topup_own","refund","income","other"]},
    "amount_raw": {"type": ["string","null"]},
    "currency": {"type": "string"},
    "merchant": {"type": ["string","null"]},
    "occurred_at_raw": {"type": ["string","null"]},
    "payment_source": {"type": ["string","null"]},
    "reference_no": {"type": ["string","null"]},
    "category": {"type": ["string","null"]},
    "note": {"type": ["string","null"]},
    "confidence": {"type": "number"},
    "reason": {"type": "string"}
  },
  "required": ["is_expense","kind","currency","confidence","reason"]
}`

// Extract memanggil LLM dengan structured output dan mem-parse hasilnya.
func (c *Client) Extract(ctx context.Context, text string, categories []string) (Result, Usage, error) {
	prompt := "Kategori valid: " + joinCats(categories) + "\n\n--- EMAIL ---\n" + text
	if c.mode == "responses" {
		return c.extractResponses(ctx, prompt)
	}
	return c.extractChat(ctx, prompt)
}

func (c *Client) extractChat(ctx context.Context, prompt string) (Result, Usage, error) {
	start := time.Now()
	req := openai.ChatCompletionRequest{
		Model: c.model,
		Messages: []openai.ChatCompletionMessage{
			{Role: openai.ChatMessageRoleSystem, Content: systemPrompt},
			{Role: openai.ChatMessageRoleUser, Content: prompt},
		},
	}
	if c.useSchema {
		req.ResponseFormat = &openai.ChatCompletionResponseFormat{
			Type: openai.ChatCompletionResponseFormatTypeJSONSchema,
			JSONSchema: &openai.ChatCompletionResponseFormatJSONSchema{
				Name: "extract_expense", Strict: true, Schema: json.RawMessage(resultSchemaJSON),
			},
		}
	} else {
		req.ResponseFormat = &openai.ChatCompletionResponseFormat{Type: openai.ChatCompletionResponseFormatTypeJSONObject}
	}
	resp, err := c.c.CreateChatCompletion(ctx, req)
	if err != nil && c.useSchema {
		// fallback: provider/model yang tak dukung json_schema
		req.ResponseFormat = &openai.ChatCompletionResponseFormat{Type: openai.ChatCompletionResponseFormatTypeJSONObject}
		resp, err = c.c.CreateChatCompletion(ctx, req)
	}
	if err != nil {
		return Result{}, Usage{}, err
	}
	if len(resp.Choices) == 0 {
		return Result{}, Usage{}, fmt.Errorf("respons kosong")
	}
	res, err := parseResult(resp.Choices[0].Message.Content)
	if err != nil {
		return Result{}, Usage{}, err
	}
	return res, Usage{
		TokensIn: resp.Usage.PromptTokens, TokensOut: resp.Usage.CompletionTokens,
		LatencyMs: int(time.Since(start).Milliseconds()), Model: c.model,
		Cost: costOf(c.model, resp.Usage.PromptTokens, resp.Usage.CompletionTokens),
	}, nil
}

func (c *Client) extractResponses(ctx context.Context, prompt string) (Result, Usage, error) {
	start := time.Now()
	var schema any
	_ = json.Unmarshal([]byte(resultSchemaJSON), &schema)

	req := openai.CreateResponseRequest{
		Model:        c.model,
		Instructions: systemPrompt,
		Input:        prompt,
		Text: &openai.ResponseTextConfig{
			Format: &openai.ResponseTextFormat{
				Type: "json_schema", Name: "extract_expense", Strict: true, Schema: schema,
			},
		},
	}
	resp, err := c.c.CreateResponse(ctx, req)
	if err != nil {
		// fallback: minta teks biasa lalu parse JSON manual
		req.Text = nil
		resp, err = c.c.CreateResponse(ctx, req)
		if err != nil {
			return Result{}, Usage{}, err
		}
	}
	out := resp.GetOutputText()
	if out == "" {
		return Result{}, Usage{}, fmt.Errorf("respons kosong")
	}
	res, err := parseResult(out)
	if err != nil {
		return Result{}, Usage{}, err
	}
	u := Usage{LatencyMs: int(time.Since(start).Milliseconds()), Model: c.model}
	if resp.Usage != nil {
		u.TokensIn = resp.Usage.InputTokens
		u.TokensOut = resp.Usage.OutputTokens
		u.Cost = costOf(c.model, u.TokensIn, u.TokensOut)
	}
	return res, u, nil
}

// parseResult mem-parse JSON; toleran terhadap pagar markdown/teks pembuka.
func parseResult(s string) (Result, error) {
	var res Result
	clean := strings.TrimSpace(s)
	if i := strings.Index(clean, "{"); i >= 0 {
		if j := strings.LastIndex(clean, "}"); j > i {
			clean = clean[i : j+1]
		}
	}
	if err := json.Unmarshal([]byte(clean), &res); err != nil {
		return Result{}, fmt.Errorf("JSON tidak valid: %w", err)
	}
	return res, nil
}

func joinCats(cats []string) string {
	if len(cats) == 0 {
		return "Makanan, Transport, Belanja, Tagihan, Hiburan, Kesehatan, Transfer, Lainnya"
	}
	return strings.Join(cats, ", ")
}

// PromptVersion untuk kolom ai_calls/extractions.
func PromptVersion() string { return promptVersion }
