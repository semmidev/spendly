package ledger

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/semmidev/spendly/internal/platform/apperr"
	"github.com/semmidev/spendly/internal/platform/web"
)

// Pengeluaran berulang MVP: daftar langganan/cicilan + tombol "catat sekarang".
// Otomatisasi penuh (jadwal) menyusul Fase 2 deteksi langganan.

type Recurring struct {
	ID       string `json:"id"`
	Amount   int64  `json:"amount"`
	Currency string `json:"currency"`
	Merchant string `json:"merchant"`
	Category string `json:"category"`
	Cadence  string `json:"cadence"`
}

func (s *Store) RecurringList(uid string) []Recurring {
	rows, err := s.pool.Query(context.Background(), `SELECT r.id::text, r.amount, r.currency, r.merchant,
		COALESCE(c.name,'Lainnya'), r.cadence FROM recurring_rules r
		LEFT JOIN categories c ON c.id=r.category_id
		WHERE r.user_id=$1 ORDER BY r.created_at DESC`, uid)
	if err != nil {
		return []Recurring{}
	}
	defer rows.Close()
	out := []Recurring{}
	for rows.Next() {
		var x Recurring
		if err := rows.Scan(&x.ID, &x.Amount, &x.Currency, &x.Merchant, &x.Category, &x.Cadence); err == nil {
			out = append(out, x)
		}
	}
	return out
}

func (s *Store) RecurringCreate(uid string, amount int64, currency, merchant, category, cadence string) (Recurring, bool) {
	if amount <= 0 {
		return Recurring{}, false
	}
	ctx := context.Background()
	catID, _ := s.resolveCategory(ctx, uid, category)
	var x Recurring
	err := s.pool.QueryRow(ctx, `INSERT INTO recurring_rules (user_id, amount, currency, merchant, category_id, cadence)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING id::text`,
		uid, amount, orDef(currency, "IDR"), merchant, catID, orDef(cadence, "monthly")).Scan(&x.ID)
	if err != nil {
		return Recurring{}, false
	}
	x.Amount, x.Currency, x.Merchant, x.Category, x.Cadence = amount, orDef(currency, "IDR"), merchant, orDef(category, "Lainnya"), orDef(cadence, "monthly")
	return x, true
}

func (s *Store) RecurringDelete(uid, id string) bool {
	ct, err := s.pool.Exec(context.Background(), `DELETE FROM recurring_rules WHERE id=$1::uuid AND user_id=$2`, id, uid)
	return err == nil && ct.RowsAffected() > 0
}

func orDef(v, fb string) string {
	if v == "" {
		return fb
	}
	return v
}

func (h *Handler) MountRecurring(r chi.Router) {
	r.Get("/recurring", h.recurringList)
	r.Post("/recurring", h.recurringCreate)
	r.Delete("/recurring/{id}", h.recurringDelete)
	r.Post("/recurring/{id}/book", h.recurringBook)
}

func (h *Handler) recurringList(w http.ResponseWriter, r *http.Request) {
	uid, _ := web.UserID(r.Context())
	web.Success(w, http.StatusOK, "Pengeluaran berulang", map[string]any{"items": h.store.RecurringList(uid)}, nil)
}

func (h *Handler) recurringCreate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Amount   int64  `json:"amount"`
		Currency string `json:"currency"`
		Merchant string `json:"merchant"`
		Category string `json:"category"`
		Cadence  string `json:"cadence"`
	}
	if err := web.Decode(r, &req); err != nil {
		web.Error(w, r, err)
		return
	}
	if req.Amount <= 0 {
		web.Error(w, r, apperr.ValidationFailed(map[string]string{"amount": "nominal harus lebih dari 0"}))
		return
	}
	uid, _ := web.UserID(r.Context())
	x, ok := h.store.RecurringCreate(uid, req.Amount, req.Currency, req.Merchant, req.Category, req.Cadence)
	if !ok {
		web.Error(w, r, apperr.Invalid("gagal menyimpan"))
		return
	}
	web.Success(w, http.StatusCreated, "Berulang tersimpan", x, nil)
}

func (h *Handler) recurringDelete(w http.ResponseWriter, r *http.Request) {
	uid, _ := web.UserID(r.Context())
	if !h.store.RecurringDelete(uid, chi.URLParam(r, "id")) {
		web.Error(w, r, apperr.NotFound("tidak ditemukan"))
		return
	}
	web.Success(w, http.StatusOK, "Dihapus", nil, nil)
}

func (h *Handler) recurringBook(w http.ResponseWriter, r *http.Request) {
	uid, _ := web.UserID(r.Context())
	var rule Recurring
	found := false
	for _, x := range h.store.RecurringList(uid) {
		if x.ID == chi.URLParam(r, "id") {
			rule = x
			found = true
		}
	}
	if !found {
		web.Error(w, r, apperr.NotFound("tidak ditemukan"))
		return
	}
	t, _ := h.store.Create(CreateInput{
		Amount: rule.Amount, Currency: rule.Currency, Category: rule.Category,
		Merchant: rule.Merchant, Note: "berulang " + rule.Cadence,
	}, uid)
	web.Success(w, http.StatusCreated, "Tercatat", t, nil)
}
