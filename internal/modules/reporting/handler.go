// Package reporting menjawab "uang habis ke mana?" — semua angka dari SQL,
// tidak pernah dari AI (PLAN §0.3). Membaca data via ledger.Store.
package reporting

import (
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/semmidev/spendly/internal/modules/ledger"
	"github.com/semmidev/spendly/internal/platform/web"
)

type Handler struct{ store *ledger.Store }

func NewHandler(store *ledger.Store) *Handler { return &Handler{store: store} }

func (h *Handler) Mount(r chi.Router) {
	r.Get("/dashboard/summary", h.summary)
	r.Get("/reports/monthly", h.report)
	r.Get("/export.csv", h.exportCSV)
}

func (h *Handler) summary(w http.ResponseWriter, r *http.Request) {
	uid, _ := web.UserID(r.Context())
	total, byCat, tren, top := h.store.Summary(r.URL.Query().Get("month"), uid)
	web.Success(w, http.StatusOK, "Ringkasan bulan ini", map[string]any{
		"total_month": total, "by_category": byCat, "tren_harian": tren, "top_merchant": top,
	}, nil)
}

func (h *Handler) report(w http.ResponseWriter, r *http.Request) {
	month := r.URL.Query().Get("month")
	year := r.URL.Query().Get("year")
	period := r.URL.Query().Get("period")
	uid, _ := web.UserID(r.Context())
	now := time.Now()

	// Tren bulanan: agregat per bulan (Jan–Des) dalam 1 tahun + pembanding tahun lalu.
	if period == "monthly" {
		start, end := ledger.YearRange(year, now)
		total, byCat, tren, top := h.store.SummaryRange(start, end, uid, "month")
		prevStart, prevEnd := ledger.YearRange(start.AddDate(-1, 0, 0).Format("2006"), now)
		last, _, _, _ := h.store.SummaryRange(prevStart, prevEnd, uid, "month")
		web.Success(w, http.StatusOK, "Laporan tahunan per bulan", map[string]any{
			"tren": tren, "by_category": byCat, "top_merchant": top,
			"total": total, "avg": total / 12,
			"compare_last_year": map[string]any{"this_year": total, "last_year": last},
		}, nil)
		return
	}

	// Tren tahunan: 6 tahun terakhir (termasuk tahun berjalan).
	if period == "yearly" {
		end := time.Date(now.Year(), 12, 31, 23, 59, 59, 0, now.Location())
		start := time.Date(now.Year()-5, 1, 1, 0, 0, 0, 0, now.Location())
		total, byCat, tren, top := h.store.SummaryRange(start, end, uid, "year")
		web.Success(w, http.StatusOK, "Laporan tahunan", map[string]any{
			"tren": tren, "by_category": byCat, "top_merchant": top,
			"total": total, "avg": total / int64(len(tren)),
		}, nil)
		return
	}

	total, byCat, tren, top := h.store.Summary(month, uid)

	prev := time.Now().AddDate(0, -1, 0).Format("2006-01")
	if len(month) == 7 {
		if t, err := time.Parse("2006-01", month); err == nil {
			prev = t.AddDate(0, -1, 0).Format("2006-01")
		}
	}
	last, _, _, _ := h.store.Summary(prev, uid)

	web.Success(w, http.StatusOK, "Laporan bulanan", map[string]any{
		"tren_harian": tren, "by_category": byCat, "top_merchant": top,
		"compare_last_month": map[string]any{"this_month": total, "last_month": last},
	}, nil)
}

func (h *Handler) exportCSV(w http.ResponseWriter, r *http.Request) {
	uid, _ := web.UserID(r.Context())
	month := r.URL.Query().Get("month")
	name, csv := h.CSV(month, uid)
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename="+name)
	_, _ = w.Write([]byte(csv))
}

// CSV membangun ekspor seluruh transaksi user (PLAN §1 Laporan).
func (h *Handler) CSV(month, uid string) (string, string) {
	items := h.store.All(uid)
	out := "id,amount,currency,merchant,category,note,occurred_at,source\n"
	for _, t := range items {
		out += fmt.Sprintf("%s,%d,%s,%s,%s,%s,%s,%s\n", t.ID, t.Amount, t.Currency,
			csvCell(t.Merchant), csvCell(t.Category), csvCell(t.Note),
			t.OccurredAt.Format(time.RFC3339), t.Source)
	}
	name := "spendly-transaksi.csv"
	if month != "" {
		name = "spendly-" + month + ".csv"
	}
	return name, out
}

func csvCell(s string) string {
	need := false
	for _, c := range s {
		if c == ',' || c == '"' || c == '\n' {
			need = true
			break
		}
	}
	if !need {
		return s
	}
	out := "\""
	for _, c := range s {
		if c == '"' {
			out += "\"\""
		} else {
			out += string(c)
		}
	}
	return out + "\""
}
