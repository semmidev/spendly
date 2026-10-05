package extraction

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/semmidev/spendly/internal/modules/ledger"
	"github.com/semmidev/spendly/internal/platform/apperr"
	"github.com/semmidev/spendly/internal/platform/web"
)

type Handler struct {
	svc    *Service
	ledger *ledger.Store
}

func NewHandler(svc *Service, store *ledger.Store) *Handler {
	return &Handler{svc: svc, ledger: store}
}

func (h *Handler) Mount(r chi.Router) {
	r.Get("/review-queue", h.reviewQueue)
	r.Post("/review-queue/{id}/confirm", h.confirm)
	r.Post("/review-queue/{id}/ignore", h.ignore)
	r.Get("/ignored", h.ignored)
	r.Post("/ignored/{id}/correct", h.correct)
	r.Post("/ignored/emails/{id}/reprocess", h.reprocess)
	r.Post("/transactions/{id}/merge", h.merge)
}

func (h *Handler) reviewQueue(w http.ResponseWriter, r *http.Request) {
	uid, _ := web.UserID(r.Context())
	rows, err := h.svc.pool.Query(r.Context(), `SELECT t.id::text, t.amount, t.currency, t.occurred_at,
		COALESCE(m.canonical_name,''), COALESCE(c.name,'Lainnya'), COALESCE(t.note,''), t.source, t.status,
		t.duplicate_of::text, t.confidence, COALESCE(t.payment_source,'')
		FROM transactions t LEFT JOIN merchants m ON m.id=t.merchant_id LEFT JOIN categories c ON c.id=t.category_id
		WHERE t.user_id=$1 AND t.deleted_at IS NULL AND t.status='needs_review'
		ORDER BY t.created_at DESC LIMIT 50`, uid)
	if err != nil {
		web.Error(w, r, err)
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id string
		var amount int64
		var currency, merch, cat, note, source, status, payment string
		var at any
		var dupOf, conf any
		if err := rows.Scan(&id, &amount, &currency, &at, &merch, &cat, &note, &source, &status, &dupOf, &conf, &payment); err == nil {
			items = append(items, map[string]any{"id": id, "amount": amount, "currency": currency,
				"occurred_at": at, "merchant": merch, "category": cat, "note": note,
				"source": source, "status": status, "duplicate_of": dupOf, "confidence": conf,
				"payment_source": payment})
		}
	}
	web.Success(w, http.StatusOK, "Antrean review", map[string]any{"items": items}, nil)
}

func (h *Handler) confirm(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Category string `json:"category"`
	}
	_ = web.Decode(r, &req)
	uid, _ := web.UserID(r.Context())
	t, ok := h.ledger.Confirm(chi.URLParam(r, "id"), uid, req.Category)
	if !ok {
		web.Error(w, r, apperr.NotFound("transaksi tidak ditemukan"))
		return
	}
	web.Success(w, http.StatusOK, "Transaksi dikonfirmasi", t, nil)
}

func (h *Handler) ignore(w http.ResponseWriter, r *http.Request) {
	uid, _ := web.UserID(r.Context())
	if !h.ledger.IgnoreTxn(chi.URLParam(r, "id"), uid) {
		web.Error(w, r, apperr.NotFound("transaksi tidak ditemukan"))
		return
	}
	web.Success(w, http.StatusOK, "Transaksi diabaikan", nil, nil)
}

func (h *Handler) ignored(w http.ResponseWriter, r *http.Request) {
	uid, _ := web.UserID(r.Context())
	trows, err := h.svc.pool.Query(r.Context(), `SELECT t.id::text, t.amount, t.currency, t.occurred_at,
		COALESCE(m.canonical_name,''), COALESCE(c.name,'Lainnya'), COALESCE(t.note,''), t.source, COALESCE(t.payment_source,'')
		FROM transactions t LEFT JOIN merchants m ON m.id=t.merchant_id LEFT JOIN categories c ON c.id=t.category_id
		WHERE t.user_id=$1 AND t.deleted_at IS NULL AND t.status='ignored'
		ORDER BY t.created_at DESC LIMIT 50`, uid)
	if err != nil {
		web.Error(w, r, err)
		return
	}
	defer trows.Close()
	txns := []map[string]any{}
	for trows.Next() {
		var id string
		var amount int64
		var currency, merch, cat, note, source, payment string
		var at any
		if err := trows.Scan(&id, &amount, &currency, &at, &merch, &cat, &note, &source, &payment); err == nil {
			txns = append(txns, map[string]any{"id": id, "amount": amount, "currency": currency,
				"occurred_at": at, "merchant": merch, "category": cat, "note": note, "source": source,
				"payment_source": payment})
		}
	}
	erows, _ := h.svc.pool.Query(r.Context(), `SELECT r.id::text, r.gmail_message_id, r.ignore_reason, r.received_at
		FROM raw_emails r JOIN gmail_connections c ON c.id=r.connection_id
		WHERE c.user_id=$1 AND r.status IN ('gated_out','ignored','dedup')
		ORDER BY r.received_at DESC NULLS LAST LIMIT 50`, uid)
	emails := []map[string]any{}
	if erows != nil {
		defer erows.Close()
		for erows.Next() {
			var id, gid, reason string
			var at any
			if err := erows.Scan(&id, &gid, &reason, &at); err == nil {
				emails = append(emails, map[string]any{"id": id, "gmail_message_id": gid, "reason": reason, "received_at": at})
			}
		}
	}
	web.Success(w, http.StatusOK, "Daftar diabaikan", map[string]any{"transactions": txns, "emails": emails}, nil)
}

func (h *Handler) correct(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Category string `json:"category"`
	}
	_ = web.Decode(r, &req)
	uid, _ := web.UserID(r.Context())
	t, ok := h.ledger.Confirm(chi.URLParam(r, "id"), uid, req.Category)
	if !ok {
		web.Error(w, r, apperr.NotFound("transaksi tidak ditemukan"))
		return
	}
	web.Success(w, http.StatusOK, "Koreksi disimpan", t, nil)
}

func (h *Handler) reprocess(w http.ResponseWriter, r *http.Request) {
	uid, _ := web.UserID(r.Context())
	ct, err := h.svc.pool.Exec(r.Context(), `UPDATE raw_emails r SET status='fetched'
		FROM gmail_connections c WHERE r.connection_id=c.id AND r.id=$1::uuid AND c.user_id=$2
		AND r.status IN ('gated_out','ignored','failed')`, chi.URLParam(r, "id"), uid)
	if err != nil || ct.RowsAffected() == 0 {
		web.Error(w, r, apperr.NotFound("email tidak ditemukan"))
		return
	}
	web.Success(w, http.StatusOK, "Email dijadwalkan ulang untuk ekstraksi", nil, nil)
}

func (h *Handler) merge(w http.ResponseWriter, r *http.Request) {
	var req struct {
		IntoID string `json:"into_id"`
	}
	if err := web.Decode(r, &req); err != nil || req.IntoID == "" {
		web.Error(w, r, apperr.Invalid("into_id wajib diisi"))
		return
	}
	uid, _ := web.UserID(r.Context())
	t, ok := h.ledger.Merge(chi.URLParam(r, "id"), req.IntoID, uid)
	if !ok {
		web.Error(w, r, apperr.NotFound("transaksi tidak ditemukan"))
		return
	}
	web.Success(w, http.StatusOK, "Transaksi digabung", t, nil)
}
