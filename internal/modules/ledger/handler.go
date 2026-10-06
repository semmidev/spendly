package ledger

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/semmidev/spendly/internal/platform/apperr"
	"github.com/semmidev/spendly/internal/platform/web"
)

type Handler struct{ store *Store }

func NewHandler(store *Store) *Handler { return &Handler{store: store} }

func (h *Handler) Mount(r chi.Router) {
	r.Get("/transactions", h.list)
	r.Post("/transactions", h.create)
	r.Patch("/transactions/{id}", h.update)
	r.Delete("/transactions/{id}", h.remove)
	r.Post("/transactions/{id}/restore", h.restore)
	r.Get("/categories", h.categories)
	r.Post("/categories", h.createCategory)
}

func parseFilter(r *http.Request) Filter {
	q := r.URL.Query()
	f := Filter{Q: q.Get("q"), Category: q.Get("category"), Source: q.Get("source"), Deleted: q.Get("deleted") == "1"}
	if v := q.Get("from"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			f.From = t
		} else if t, err := time.Parse("2006-01-02", v); err == nil {
			f.From = t
		}
	}
	if v := q.Get("to"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			f.To = t
		} else if t, err := time.Parse("2006-01-02", v); err == nil {
			f.To = t.Add(23*time.Hour + 59*time.Minute + 59*time.Second)
		}
	}
	if v, err := strconv.ParseInt(q.Get("min"), 10, 64); err == nil {
		f.Min = v
	}
	if v, err := strconv.ParseInt(q.Get("max"), 10, 64); err == nil {
		f.Max = v
	}
	if v, err := strconv.Atoi(q.Get("page")); err == nil {
		f.Page = v
	}
	if v, err := strconv.Atoi(q.Get("limit")); err == nil {
		f.Limit = v
	}
	return f
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	f := parseFilter(r)
	uid, _ := web.UserID(r.Context())
	items, total := h.store.List(f, uid)
	limit := f.Limit
	if limit <= 0 {
		limit = 20
	}
	page := f.Page
	if page <= 0 {
		page = 1
	}
	web.Success(w, http.StatusOK, "Daftar transaksi", map[string]any{"items": items},
		map[string]any{"total": total, "page": page, "limit": limit})
}

type createReq struct {
	Amount     int64  `json:"amount"`
	Currency   string `json:"currency"`
	Category   string `json:"category"`
	Merchant   string `json:"merchant"`
	Note       string `json:"note"`
	OccurredAt string `json:"occurred_at"`
}

func parseOccurredAt(s string) time.Time {
	if s == "" {
		return time.Now()
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t
	}
	if t, err := time.Parse("2006-01-02", s); err == nil {
		// email bank tanpa offset → WIB (PLAN §4.2)
		return time.Date(t.Year(), t.Month(), t.Day(), 12, 0, 0, 0, time.FixedZone("WIB", 7*3600))
	}
	return time.Now()
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	req, err := web.DecodeTyped[createReq](r)
	if err != nil {
		web.Error(w, r, err)
		return
	}
	if req.Amount <= 0 {
		web.Error(w, r, apperr.ValidationFailed(map[string]string{"amount": "nominal harus lebih dari 0"}))
		return
	}
	uid, _ := web.UserID(r.Context())
	t, dup := h.store.Create(CreateInput{
		Amount: req.Amount, Currency: req.Currency, Category: req.Category,
		Merchant: req.Merchant, Note: req.Note, OccurredAt: parseOccurredAt(req.OccurredAt),
	}, uid)
	data := map[string]any{"transaction": t}
	if dup != nil {
		data["possible_duplicate_of"] = dup.ID
		data["hint"] = "nominal sama dalam ±1 hari — cek sebelum menyimpan ganda"
	}
	web.Success(w, http.StatusCreated, "Transaksi tersimpan", data, nil)
}

func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Note     string `json:"note"`
		Category string `json:"category"`
	}
	if err := web.Decode(r, &req); err != nil {
		web.Error(w, r, err)
		return
	}
	uid, _ := web.UserID(r.Context())
	t, ok := h.store.Update(chi.URLParam(r, "id"), req.Note, req.Category, uid)
	if !ok {
		web.Error(w, r, apperr.NotFound("transaksi tidak ditemukan"))
		return
	}
	web.Success(w, http.StatusOK, "Transaksi diperbarui", t, nil)
}

func (h *Handler) remove(w http.ResponseWriter, r *http.Request) {
	uid, _ := web.UserID(r.Context())
	if !h.store.Delete(chi.URLParam(r, "id"), uid) {
		web.Error(w, r, apperr.NotFound("transaksi tidak ditemukan"))
		return
	}
	web.Success(w, http.StatusOK, "Transaksi dihapus", nil, nil)
}

func (h *Handler) restore(w http.ResponseWriter, r *http.Request) {
	uid, _ := web.UserID(r.Context())
	if !h.store.Restore(chi.URLParam(r, "id"), uid) {
		web.Error(w, r, apperr.NotFound("transaksi tidak ditemukan"))
		return
	}
	web.Success(w, http.StatusOK, "Penghapusan dibatalkan", nil, nil)
}

func (h *Handler) categories(w http.ResponseWriter, r *http.Request) {
	uid, _ := web.UserID(r.Context())
	items := h.store.Categories(uid)
	web.Success(w, http.StatusOK, "Kategori", map[string]any{"items": items}, nil)
}

func (h *Handler) createCategory(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if err := web.Decode(r, &req); err != nil {
		web.Error(w, r, err)
		return
	}
	if req.Name == "" {
		web.Error(w, r, apperr.ValidationFailed(map[string]string{"name": "nama wajib diisi"}))
		return
	}
	uid, _ := web.UserID(r.Context())
	if !h.store.CreateCategory(req.Name, uid) {
		web.Error(w, r, apperr.Invalid("kategori tidak dapat disimpan"))
		return
	}
	web.Success(w, http.StatusCreated, "Kategori ditambahkan", map[string]any{"name": req.Name}, nil)
}
