package e2e

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
)

type txListResp struct {
	Data struct {
		Items []struct {
			ID     string `json:"id"`
			Source string `json:"source"`
		} `json:"items"`
	} `json:"data"`
	Meta struct {
		Total int `json:"total"`
	} `json:"meta"`
}

func devUID(t *testing.T, a *api) string {
	t.Helper()
	var uid string
	if err := a.pool.QueryRow(context.Background(), `SELECT id::text FROM users WHERE google_sub='dev'`).Scan(&uid); err != nil {
		t.Fatalf("dev user: %v", err)
	}
	return uid
}

// TestTransactionsPaginationAndFilters: paginasi + filter status/sumber + Sampah.
func TestTransactionsPaginationAndFilters(t *testing.T) {
	a := newAPI(t)
	a.login()
	ctx := context.Background()
	uid := devUID(t, a)

	// 25 confirmed (20 manual, 5 email) + 1 needs_review + 1 ignored.
	for i := 0; i < 25; i++ {
		src := "manual"
		if i%5 == 0 {
			src = "email"
		}
		if _, err := a.pool.Exec(ctx, `INSERT INTO transactions (user_id, amount, currency, occurred_at, source, status)
			VALUES ($1,$2,'IDR', now() - make_interval(mins => $3), $4, 'confirmed')`, uid, 1000+i, i, src); err != nil {
			t.Fatalf("seed %d: %v", i, err)
		}
	}
	if _, err := a.pool.Exec(ctx, `INSERT INTO transactions (user_id, amount, currency, occurred_at, source, status)
		VALUES ($1,9999,'IDR',now(),'email','needs_review')`, uid); err != nil {
		t.Fatalf("seed review: %v", err)
	}
	if _, err := a.pool.Exec(ctx, `INSERT INTO transactions (user_id, amount, currency, occurred_at, source, status)
		VALUES ($1,8888,'IDR',now(),'email','ignored')`, uid); err != nil {
		t.Fatalf("seed ignored: %v", err)
	}

	// Page 1: 20 item, total 25 (needs_review/ignored tidak dihitung).
	code, body := a.do("GET", "/api/v1/transactions?limit=20", nil, false)
	if code != http.StatusOK {
		t.Fatalf("list p1 = %d %s", code, body)
	}
	var p1 txListResp
	if err := json.Unmarshal(body, &p1); err != nil {
		t.Fatalf("unmarshal p1: %v", err)
	}
	if len(p1.Data.Items) != 20 || p1.Meta.Total != 25 {
		t.Fatalf("p1 len=%d total=%d, mau 20/25", len(p1.Data.Items), p1.Meta.Total)
	}

	// Page 2: sisa 5.
	_, body = a.do("GET", "/api/v1/transactions?page=2&limit=20", nil, false)
	var p2 txListResp
	_ = json.Unmarshal(body, &p2)
	if len(p2.Data.Items) != 5 {
		t.Fatalf("p2 len=%d, mau 5", len(p2.Data.Items))
	}

	// Filter sumber=manual.
	_, body = a.do("GET", "/api/v1/transactions?source=manual&limit=100", nil, false)
	var pm txListResp
	_ = json.Unmarshal(body, &pm)
	if pm.Meta.Total != 20 {
		t.Fatalf("source=manual total=%d, mau 20", pm.Meta.Total)
	}
	for _, it := range pm.Data.Items {
		if it.Source != "manual" {
			t.Fatalf("source=manual memuat source=%q", it.Source)
		}
	}

	// Sampah: hapus → hilang dari list, muncul di deleted=1, restore → kembali.
	id := p1.Data.Items[0].ID
	if code, _ := a.do("DELETE", "/api/v1/transactions/"+id, nil, true); code != http.StatusOK {
		t.Fatalf("delete = %d", code)
	}
	_, body = a.do("GET", "/api/v1/transactions?limit=100", nil, false)
	var afterDel txListResp
	_ = json.Unmarshal(body, &afterDel)
	if afterDel.Meta.Total != 24 {
		t.Fatalf("setelah hapus total=%d, mau 24", afterDel.Meta.Total)
	}
	_, body = a.do("GET", "/api/v1/transactions?deleted=1&limit=100", nil, false)
	var trash txListResp
	_ = json.Unmarshal(body, &trash)
	if trash.Meta.Total != 1 || len(trash.Data.Items) != 1 {
		t.Fatalf("sampah total=%d len=%d, mau 1/1", trash.Meta.Total, len(trash.Data.Items))
	}
	if code, _ := a.do("POST", "/api/v1/transactions/"+id+"/restore", nil, true); code != http.StatusOK {
		t.Fatalf("restore = %d", code)
	}
	_, body = a.do("GET", "/api/v1/transactions?limit=100", nil, false)
	var afterRestore txListResp
	_ = json.Unmarshal(body, &afterRestore)
	if afterRestore.Meta.Total != 25 {
		t.Fatalf("setelah restore total=%d, mau 25", afterRestore.Meta.Total)
	}
}

// TestReviewQueuePagination: antrean Tinjau terpaginasi + meta.total.
func TestReviewQueuePagination(t *testing.T) {
	a := newAPI(t)
	a.login()
	ctx := context.Background()
	uid := devUID(t, a)

	for i := 0; i < 25; i++ {
		if _, err := a.pool.Exec(ctx, `INSERT INTO transactions (user_id, amount, currency, occurred_at, source, status)
			VALUES ($1,$2,'IDR', now() - make_interval(mins => $3), 'email', 'needs_review')`, uid, 500+i, i); err != nil {
			t.Fatalf("seed review %d: %v", i, err)
		}
	}

	code, body := a.do("GET", "/api/v1/review-queue?limit=20", nil, false)
	if code != http.StatusOK {
		t.Fatalf("review p1 = %d %s", code, body)
	}
	var p1 txListResp
	if err := json.Unmarshal(body, &p1); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(p1.Data.Items) != 20 || p1.Meta.Total != 25 {
		t.Fatalf("review p1 len=%d total=%d, mau 20/25", len(p1.Data.Items), p1.Meta.Total)
	}
	_, body = a.do("GET", "/api/v1/review-queue?page=2&limit=20", nil, false)
	var p2 txListResp
	_ = json.Unmarshal(body, &p2)
	if len(p2.Data.Items) != 5 {
		t.Fatalf("review p2 len=%d, mau 5", len(p2.Data.Items))
	}
}
