package extraction

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/semmidev/spendly/internal/modules/ledger"
	"github.com/semmidev/spendly/internal/modules/mailsync"
	"github.com/semmidev/spendly/internal/platform/config"
	"github.com/semmidev/spendly/internal/provider/llm"
)

// Service memenuhi mailsync.Extractor. AI mengekstrak, kode menghitung (PLAN §4).
type Service struct {
	pool   *pgxpool.Pool
	cfg    *config.Config
	mail   *mailsync.Service
	ledger *ledger.Store
	ai     *llm.Client
}

func NewService(pool *pgxpool.Pool, cfg *config.Config, mail *mailsync.Service) *Service {
	s := &Service{pool: pool, cfg: cfg, mail: mail, ledger: ledger.NewStorePG(pool)}
	if cfg.AIConfigured() {
		s.ai = llm.New(cfg.AIAPIKey, cfg.AIBaseURL, cfg.AIModel, cfg.AIAPIMode)
	}
	return s
}

// reviewThreshold: confidence di bawah ini → antrean review (konservatif dulu).
const reviewThreshold = 0.7

func (s *Service) ProcessRaw(ctx context.Context, rawID string) error {
	var userID, connID, gmailID, hash string
	var received time.Time
	err := s.pool.QueryRow(ctx, `SELECT r.connection_id::text, r.gmail_message_id, r.content_hash, r.received_at, c.user_id::text
		FROM raw_emails r JOIN gmail_connections c ON c.id=r.connection_id
		WHERE r.id=$1::uuid AND r.status='fetched'`, rawID).Scan(&connID, &gmailID, &hash, &received, &userID)
	if err != nil {
		return err // bukan fetched / tidak ada → lewati
	}
	_, _ = s.pool.Exec(ctx, `UPDATE raw_emails SET status='extracting' WHERE id=$1::uuid`, rawID)

	from, subject, text, recv, err := s.mail.FetchText(ctx, connID, gmailID)
	if err != nil {
		return s.fail(ctx, rawID, err.Error())
	}
	if !recv.IsZero() {
		received = recv
	}
	redacted := mailsync.Redact(text)

	// cache: hash sama pernah diekstrak → pakai ulang (PLAN §4.5)
	if cached, ok := s.cached(ctx, userID, hash); ok {
		s.enrich(&cached, from, text)
		return s.apply(ctx, rawID, userID, received, cached, llm.Usage{}, true)
	}

	var res llm.Result
	var usage llm.Usage
	if s.ai != nil {
		ctxAI, cancel := context.WithTimeout(ctx, 40*time.Second)
		r, u, err := s.ai.Extract(ctxAI, "From: "+from+"\nSubject: "+subject+"\n\n"+redacted, s.ledger.Categories(userID))
		cancel()
		if err == nil {
			res, usage = r, u
			slog.Debug("AI ekstraksi", "raw", shortID(rawID), "model", u.Model,
				"tokens_in", u.TokensIn, "tokens_out", u.TokensOut, "cost", u.Cost, "latency_ms", u.LatencyMs)
		} else {
			slog.Warn("AI gagal, pakai parser lokal", "raw", shortID(rawID), "error", err)
			res = FallbackExtract(from, subject, text)
		}
	} else {
		slog.Debug("tanpa AI, pakai parser lokal", "raw", shortID(rawID))
		res = FallbackExtract(from, subject, text)
	}
	s.enrich(&res, from, text)
	recordAI(ctx, s.pool, userID, usage)
	return s.apply(ctx, rawID, userID, received, res, usage, false)
}

// enrich mengisi field yang sering terlewat AI secara deterministik:
// payment_source dari pengirim/isi email, reference_no dari regex umum.
func (s *Service) enrich(res *llm.Result, from, text string) {
	if res.PaymentSource == nil || strings.TrimSpace(*res.PaymentSource) == "" {
		if ps := DerivePaymentSource(from, text); ps != "" {
			res.PaymentSource = &ps
		}
	}
	if res.ReferenceNo == nil || strings.TrimSpace(*res.ReferenceNo) == "" {
		if m := refRe.FindStringSubmatch(text); m != nil {
			if ref := strings.Trim(m[1], ":-/. "); ref != "" {
				res.ReferenceNo = &ref
			}
		}
	}
}

func (s *Service) cached(ctx context.Context, userID, hash string) (llm.Result, bool) {
	var raw string
	var conf float64
	err := s.pool.QueryRow(ctx, `SELECT e.result_json::text, e.confidence FROM extractions e
		JOIN raw_emails r ON r.id=e.raw_email_id
		JOIN gmail_connections c ON c.id=r.connection_id
		WHERE r.content_hash=$1 AND c.user_id=$2 AND e.result_json IS NOT NULL LIMIT 1`, hash, userID).Scan(&raw, &conf)
	if err != nil || raw == "" {
		return llm.Result{}, false
	}
	var res llm.Result
	if err := json.Unmarshal([]byte(raw), &res); err != nil {
		return llm.Result{}, false
	}
	return res, true
}

func (s *Service) apply(ctx context.Context, rawID, userID string, received time.Time, res llm.Result, usage llm.Usage, fromCache bool) error {
	saveExtraction(ctx, s.pool, rawID, res, usage, fromCache)

	kind := strings.ToLower(res.Kind)
	if kind == "" {
		kind = "other"
	}
	expenseKind := res.IsExpense && (kind == "purchase" || kind == "transfer_out")
	if !expenseKind {
		reason := kind
		if !res.IsExpense && kind == "purchase" {
			reason = "other"
		}
		_, _ = s.pool.Exec(ctx, `UPDATE raw_emails SET status='ignored', ignore_reason=$2 WHERE id=$1::uuid`, rawID, reason)
		slog.Info("email bukan pengeluaran", "raw", shortID(rawID), "kind", reason)
		return nil
	}

	// angka & tanggal diparse di Go (PLAN §4.2)
	amount, ok := ParseAmount(deref(res.AmountRaw))
	currency := strings.ToUpper(orDefault(res.Currency, "IDR"))
	at, okDate := ParseDate(deref(res.OccurredAtRaw), received)
	if received.IsZero() {
		received = time.Now()
	}
	if !okDate {
		at = received
	}
	valid := ok && amount > 0 && validCurrency(currency)
	needsReview := !valid || res.Confidence < reviewThreshold

	merchant := ledger.NormalizePublic(res.Merchant)
	category := deref(res.Category)
	ref := deref(res.ReferenceNo)
	fp := ledger.Fingerprint(userID, amount, currency, ref)

	status := "confirmed"
	dupOf := ""
	if valid {
		if dupOf = s.ledger.FindDuplicate(userID, amount, at, merchant); dupOf != "" {
			status = "needs_review" // jangan hapus otomatis (PLAN §5)
		} else if m := s.ledger.FindManualMatch(userID, amount, at); m != "" {
			status = "needs_review"
			dupOf = m
		}
	}
	if needsReview && status == "confirmed" {
		status = "needs_review"
	}

	if !valid {
		_, _ = s.pool.Exec(ctx, `UPDATE raw_emails SET status='needs_review', ignore_reason='validasi gagal' WHERE id=$1::uuid`, rawID)
		// tetap simpan sebagai needs_review agar bisa dikoreksi manual
		amount = nzAmount(amount)
	}
	txID, inserted := s.ledger.CreateEmail(ledger.EmailInput{
		Amount: amount, Currency: currency, OccurredAt: at,
		Merchant: merchant, Category: category, Source: deref(res.PaymentSource),
		Note:       deref(res.Note),
		RawEmailID: rawID, ReferenceNo: ref, Fingerprint: fp,
		Status: status, DuplicateOf: dupOf, Confidence: res.Confidence,
	}, userID)
	if !inserted {
		_, _ = s.pool.Exec(ctx, `UPDATE raw_emails SET status='dedup' WHERE id=$1::uuid`, rawID)
		slog.Info("transaksi duplikat (fingerprint)", "raw", shortID(rawID), "amount", amount, "merchant", merchant)
		return nil
	}
	final := "parsed"
	if status == "needs_review" {
		final = "needs_review"
	}
	_, _ = s.pool.Exec(ctx, `UPDATE raw_emails SET status=$2 WHERE id=$1::uuid`, rawID, final)
	slog.Info("transaksi dicatat",
		"raw", shortID(rawID), "status", final, "amount", amount, "currency", currency,
		"merchant", merchant, "category", category, "confidence", res.Confidence,
		"punya_ref", ref != "", "dari_cache", fromCache)
	_ = txID
	return nil
}

func (s *Service) fail(ctx context.Context, rawID, msg string) error {
	msg = truncate(msg, 300)
	_, _ = s.pool.Exec(ctx, `UPDATE raw_emails SET status='failed', ignore_reason=$2, error=$2 WHERE id=$1::uuid`, rawID, msg)
	return nil
}

func saveExtraction(ctx context.Context, pool *pgxpool.Pool, rawID string, res llm.Result, u llm.Usage, fromCache bool) {
	b, _ := json.Marshal(res)
	model := u.Model
	if fromCache {
		model = "cache:" + model
	}
	_, _ = pool.Exec(ctx, `INSERT INTO extractions (raw_email_id, model, prompt_version, result_json, confidence, tokens_in, tokens_out, cost)
		VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8)
		ON CONFLICT (raw_email_id) DO UPDATE SET model=EXCLUDED.model, result_json=EXCLUDED.result_json, confidence=EXCLUDED.confidence`,
		rawID, model, llm.PromptVersion(), string(b), res.Confidence, u.TokensIn, u.TokensOut, u.Cost)
}

func recordAI(ctx context.Context, pool *pgxpool.Pool, userID string, u llm.Usage) {
	if u.Model == "" {
		return
	}
	_, _ = pool.Exec(ctx, `INSERT INTO ai_calls (user_id, feature, model, prompt_version, tokens_in, tokens_out, cost, latency_ms)
		VALUES ($1,'extract',$2,$3,$4,$5,$6,$7)`, userID, u.Model, llm.PromptVersion(), u.TokensIn, u.TokensOut, u.Cost, u.LatencyMs)
}

func validCurrency(c string) bool {
	if len(c) != 3 {
		return false
	}
	for _, r := range c {
		if r < 'A' || (r > 'Z' && r < 'a') || r > 'z' {
			return false
		}
	}
	return true
}

func nzAmount(v int64) int64 {
	if v <= 0 {
		return 0
	}
	return v
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func orDefault(v, fb string) string {
	if v == "" {
		return fb
	}
	return v
}

func shortID(id string) string {
	if len(id) > 8 {
		return id[:8]
	}
	return id
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
