package mailsync

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/semmidev/spendly/internal/platform/apperr"
	"github.com/semmidev/spendly/internal/platform/middleware"
	"github.com/semmidev/spendly/internal/platform/web"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) Mount(r chi.Router) {
	r.Get("/senders/recommended", h.recommended)
	r.Get("/senders", h.listSenders)
	r.Put("/senders", h.putSenders)
	r.Post("/senders/registry", h.addSender)
	r.Delete("/senders/registry/{id}", h.deleteSender)
	// Sync memanggil Gmail + AI (mahal) → batasi lebih ketat per IP.
	r.With(middleware.RateLimit(10, time.Minute)).Post("/gmail/sync", h.startSync)
	r.Get("/gmail/sync/active", h.activeSync)
	r.Get("/gmail/sync/{id}", h.syncStatus)
	r.Post("/gmail/sync/{id}/pause", h.pauseSync)
	r.Post("/gmail/sync/{id}/resume", h.resumeSync)
	r.Post("/gmail/sync/{id}/cancel", h.cancelSync)
	r.Get("/gmail/sync/{id}/events", h.syncEvents)
	r.Get("/sync/status", h.status)
	r.Patch("/gmail/connections/{id}", h.updateSettings)
}

func (h *Handler) connID(r *http.Request) string {
	if id := r.URL.Query().Get("connection_id"); id != "" {
		return id
	}
	uid, _ := web.UserID(r.Context())
	return h.svc.firstConnection(r.Context(), uid)
}

func (h *Handler) recommended(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.pool.Query(r.Context(), `SELECT domain, label FROM sender_registry WHERE enabled ORDER BY label`)
	if err != nil {
		web.Error(w, r, err)
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var d, l string
		if err := rows.Scan(&d, &l); err == nil {
			items = append(items, map[string]any{"domain": d, "label": l})
		}
	}
	web.Success(w, http.StatusOK, "Sender rekomendasi", map[string]any{"items": items}, nil)
}

func (h *Handler) listSenders(w http.ResponseWriter, r *http.Request) {
	id := h.connID(r)
	if id == "" {
		web.Error(w, r, apperr.Invalid("belum ada koneksi Gmail"))
		return
	}
	uid, _ := web.UserID(r.Context())
	rows, err := h.svc.pool.Query(r.Context(), `SELECT g.id::text, g.domain, g.label, COALESCE(u.allowed,false),
		g.is_seed, (g.created_by IS NOT NULL AND g.created_by::text=$2)
		FROM sender_registry g
		LEFT JOIN user_senders u ON u.sender_domain=g.domain AND u.connection_id=$1::uuid
		WHERE g.enabled ORDER BY g.label`, id, uid)
	if err != nil {
		web.Error(w, r, err)
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var gid, d, l string
		var a, seed, canDelete bool
		if err := rows.Scan(&gid, &d, &l, &a, &seed, &canDelete); err == nil {
			items = append(items, map[string]any{"id": gid, "domain": d, "label": l,
				"allowed": a, "is_seed": seed, "can_delete": canDelete})
		}
	}
	web.Success(w, http.StatusOK, "Sender yang dibaca", map[string]any{"items": items, "connection_id": id}, nil)
}

func (h *Handler) addSender(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Domain string `json:"domain"`
		Label  string `json:"label"`
	}
	if err := web.Decode(r, &req); err != nil {
		web.Error(w, r, err)
		return
	}
	uid, _ := web.UserID(r.Context())
	item, err := h.svc.AddSender(r.Context(), uid, req.Domain, req.Label)
	if err != nil {
		web.Error(w, r, err)
		return
	}
	web.Success(w, http.StatusCreated, "Pengirim ditambahkan", item, nil)
}

func (h *Handler) deleteSender(w http.ResponseWriter, r *http.Request) {
	uid, _ := web.UserID(r.Context())
	if err := h.svc.DeleteSender(r.Context(), uid, chi.URLParam(r, "id")); err != nil {
		web.Error(w, r, err)
		return
	}
	web.Success(w, http.StatusOK, "Pengirim dihapus", nil, nil)
}

func (h *Handler) putSenders(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ConnectionID string   `json:"connection_id"`
		Domains      []string `json:"domains"`
	}
	if err := web.Decode(r, &req); err != nil {
		web.Error(w, r, err)
		return
	}
	uid, _ := web.UserID(r.Context())
	if req.ConnectionID == "" {
		req.ConnectionID = h.svc.firstConnection(r.Context(), uid)
	}
	if req.ConnectionID == "" {
		web.Error(w, r, apperr.Invalid("belum ada koneksi Gmail"))
		return
	}
	if err := h.svc.SetAllowed(r.Context(), uid, req.ConnectionID, req.Domains); err != nil {
		web.Error(w, r, err)
		return
	}
	web.Success(w, http.StatusOK, "Pilihan sender disimpan", map[string]any{"allowed": len(req.Domains)}, nil)
}

func (h *Handler) startSync(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ConnectionID string `json:"connection_id"`
		Force        bool   `json:"force"`
		MaxEmails    int    `json:"max_emails"`
	}
	_ = web.Decode(r, &req)
	uid, _ := web.UserID(r.Context())
	if req.ConnectionID == "" {
		req.ConnectionID = h.svc.firstConnection(r.Context(), uid)
	}
	jobID, err := h.svc.StartSyncJob(r.Context(), uid, req.ConnectionID, req.Force, req.MaxEmails)
	if err != nil {
		web.Error(w, r, err)
		return
	}
	web.Success(w, http.StatusAccepted, "Sinkronisasi dimulai", map[string]any{"job_id": jobID}, nil)
}

// activeSync mengembalikan job yang masih berjalan/dijeda untuk koneksi ini.
func (h *Handler) activeSync(w http.ResponseWriter, r *http.Request) {
	uid, _ := web.UserID(r.Context())
	connID := r.URL.Query().Get("connection_id")
	if connID == "" {
		connID = h.svc.firstConnection(r.Context(), uid)
	}
	if connID == "" {
		web.Error(w, r, apperr.NotFound("tidak ada job sinkronisasi yang aktif"))
		return
	}
	jobID, ok := h.svc.ActiveSyncJob(r.Context(), uid, connID)
	if !ok {
		web.Error(w, r, apperr.NotFound("tidak ada job sinkronisasi yang aktif"))
		return
	}
	web.Success(w, http.StatusOK, "Job sinkronisasi aktif", map[string]any{"job_id": jobID}, nil)
}

func (h *Handler) syncStatus(w http.ResponseWriter, r *http.Request) {
	uid, _ := web.UserID(r.Context())
	jobID := chi.URLParam(r, "id")
	p, ok := h.svc.SyncJobProgress(jobID, uid)
	if !ok {
		web.Error(w, r, apperr.NotFound("job sinkronisasi tidak ditemukan"))
		return
	}
	stats, _ := h.svc.SyncJobStats(jobID, uid)
	web.Success(w, http.StatusOK, "Status sinkronisasi", map[string]any{"progress": p, "stats": stats}, nil)
}

func (h *Handler) pauseSync(w http.ResponseWriter, r *http.Request) {
	h.control(w, r, h.svc.PauseSyncJob, "Sinkronisasi dijeda")
}

func (h *Handler) resumeSync(w http.ResponseWriter, r *http.Request) {
	h.control(w, r, h.svc.ResumeSyncJob, "Sinkronisasi dilanjutkan")
}

func (h *Handler) cancelSync(w http.ResponseWriter, r *http.Request) {
	h.control(w, r, h.svc.CancelSyncJob, "Sinkronisasi dihentikan")
}

func (h *Handler) control(w http.ResponseWriter, r *http.Request, fn func(string, string) error, msg string) {
	uid, _ := web.UserID(r.Context())
	if err := fn(chi.URLParam(r, "id"), uid); err != nil {
		web.Error(w, r, err)
		return
	}
	web.Success(w, http.StatusOK, msg, nil, nil)
}

// syncEvents: SSE progres real-time (server → klien).
func (h *Handler) syncEvents(w http.ResponseWriter, r *http.Request) {
	uid, _ := web.UserID(r.Context())
	ch, unsub, ok := h.svc.SubscribeSyncJob(chi.URLParam(r, "id"), uid)
	if !ok {
		web.Error(w, r, apperr.NotFound("job sinkronisasi tidak ditemukan"))
		return
	}
	defer unsub()
	flusher, ok := w.(http.Flusher)
	if !ok {
		web.Error(w, r, apperr.Internal("streaming tidak didukung", nil))
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	enc := json.NewEncoder(w)
	for {
		select {
		case <-r.Context().Done():
			return
		case p, open := <-ch:
			if !open {
				return
			}
			_, _ = w.Write([]byte("data: "))
			_ = enc.Encode(p)
			_, _ = w.Write([]byte("\n"))
			flusher.Flush()
			if p.Status == "done" || p.Status == "error" || p.Status == "canceled" {
				return
			}
		}
	}
}

// updateSettings menyimpan jendela + batas email per sinkronisasi.
func (h *Handler) updateSettings(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ScanWindow string `json:"scan_window"`
		ScanLimit  int    `json:"scan_limit"`
		ScanFrom   string `json:"scan_from"`
		ScanTo     string `json:"scan_to"`
	}
	if err := web.Decode(r, &req); err != nil {
		web.Error(w, r, err)
		return
	}
	if !validWindow(req.ScanWindow) {
		web.Error(w, r, apperr.ValidationFailed(map[string]string{"scan_window": "pilih 1d/7d/month/30d/90d/custom"}))
		return
	}
	if req.ScanLimit <= 0 || req.ScanLimit > 1000 {
		web.Error(w, r, apperr.ValidationFailed(map[string]string{"scan_limit": "pilih 1-1000 email"}))
		return
	}
	backfillDays, err := validateCustomRange(req.ScanWindow, req.ScanFrom, req.ScanTo)
	if err != nil {
		web.Error(w, r, err)
		return
	}
	uid, _ := web.UserID(r.Context())
	if err := h.svc.SetSettings(r.Context(), uid, chi.URLParam(r, "id"), req.ScanWindow, req.ScanLimit, req.ScanFrom, req.ScanTo); err != nil {
		web.Error(w, r, err)
		return
	}
	data := map[string]any{"scan_window": req.ScanWindow, "backfill_days": backfillDays, "scan_limit": req.ScanLimit}
	if req.ScanWindow == "custom" {
		data["scan_from"] = req.ScanFrom
		data["scan_to"] = req.ScanTo
	}
	web.Success(w, http.StatusOK, "Pengaturan scan disimpan", data, nil)
}

// validateCustomRange memvalidasi rentang kustom (YYYY-MM-DD) dan mengembalikan
// jumlah hari. Window non-custom memakai windowDays preset.
func validateCustomRange(window, from, to string) (int, error) {
	if window != "custom" {
		return windowDays(window), nil
	}
	f, err1 := time.Parse("2006-01-02", from)
	t, err2 := time.Parse("2006-01-02", to)
	if err1 != nil || err2 != nil {
		return 0, apperr.ValidationFailed(map[string]string{"scan_from": "tanggal tidak valid (YYYY-MM-DD)"})
	}
	if t.Before(f) {
		return 0, apperr.ValidationFailed(map[string]string{"scan_to": "tanggal akhir harus >= tanggal awal"})
	}
	if t.Sub(f).Hours() > 366*24 {
		return 0, apperr.ValidationFailed(map[string]string{"scan_to": "rentang maksimal 366 hari"})
	}
	return int(t.Sub(f).Hours()/24) + 1, nil
}

func (h *Handler) status(w http.ResponseWriter, r *http.Request) {
	id := h.connID(r)
	if id == "" {
		web.Error(w, r, apperr.Invalid("belum ada koneksi Gmail"))
		return
	}
	uid, _ := web.UserID(r.Context())
	st, err := h.svc.Status(r.Context(), uid, id)
	if err != nil {
		web.Error(w, r, err)
		return
	}
	st["connection_id"] = id
	web.Success(w, http.StatusOK, "Status sinkronisasi", st, nil)
}
