package ledger

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Transaction: uang BIGINT minor unit + currency (PLAN §6). Hanya pengeluaran.
type Transaction struct {
	ID         string    `json:"id"`
	Amount     int64     `json:"amount"`
	Currency   string    `json:"currency"`
	OccurredAt time.Time `json:"occurred_at"`
	Merchant   string    `json:"merchant,omitempty"`
	Category   string    `json:"category"`
	Note       string    `json:"note,omitempty"`
	Source     string    `json:"source"`
	Status     string    `json:"status,omitempty"`
}

type Filter struct {
	Q        string
	Category string
	From     time.Time
	To       time.Time
	Min      int64
	Max      int64
	Page     int
	Limit    int
}

type Store struct {
	pool *pgxpool.Pool
}

func NewStorePG(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

// ---- list ----

func (s *Store) List(f Filter, uid string) ([]Transaction, int) {
	return s.listPG(context.Background(), f, uid)
}

func (s *Store) listPG(ctx context.Context, f Filter, uid string) ([]Transaction, int) {
	where := "t.user_id=$1 AND t.deleted_at IS NULL"
	args := []any{uid}
	if f.Q != "" {
		args = append(args, "%"+f.Q+"%")
		where += " AND (m.canonical_name ILIKE $" + itoa(len(args)) + " OR c.name ILIKE $" + itoa(len(args)) + " OR t.note ILIKE $" + itoa(len(args)) + ")"
	}
	if f.Category != "" {
		args = append(args, f.Category)
		where += " AND c.name=$" + itoa(len(args))
	}
	if !f.From.IsZero() {
		args = append(args, f.From)
		where += " AND t.occurred_at>=$" + itoa(len(args))
	}
	if !f.To.IsZero() {
		args = append(args, f.To)
		where += " AND t.occurred_at<=$" + itoa(len(args))
	}
	if f.Min > 0 {
		args = append(args, f.Min)
		where += " AND t.amount>=$" + itoa(len(args))
	}
	if f.Max > 0 {
		args = append(args, f.Max)
		where += " AND t.amount<=$" + itoa(len(args))
	}
	var total int
	_ = s.pool.QueryRow(ctx, "SELECT COUNT(*) FROM transactions t LEFT JOIN merchants m ON m.id=t.merchant_id LEFT JOIN categories c ON c.id=t.category_id WHERE "+where, args...).Scan(&total)

	limit, offset := pageArgs(f.Page, f.Limit)
	args = append(args, limit, offset)
	rows, err := s.pool.Query(ctx, `SELECT t.id, t.amount, t.currency, t.occurred_at,
		COALESCE(m.canonical_name,''), COALESCE(c.name,'Lainnya'), COALESCE(t.note,''), t.source, t.status
		FROM transactions t LEFT JOIN merchants m ON m.id=t.merchant_id LEFT JOIN categories c ON c.id=t.category_id
		WHERE `+where+` ORDER BY t.occurred_at DESC, t.created_at DESC LIMIT $`+itoa(len(args)-1)+` OFFSET $`+itoa(len(args)), args...)
	if err != nil {
		return []Transaction{}, 0
	}
	defer rows.Close()
	var out []Transaction
	for rows.Next() {
		var t Transaction
		var id string
		if err := rows.Scan(&id, &t.Amount, &t.Currency, &t.OccurredAt, &t.Merchant, &t.Category, &t.Note, &t.Source, &t.Status); err != nil {
			continue
		}
		t.ID = id
		out = append(out, t)
	}
	if out == nil {
		out = []Transaction{}
	}
	return out, total
}

// All mengembalikan seluruh transaksi user (tanpa paginasi) — untuk export.
func (s *Store) All(uid string) []Transaction {
	rows, err := s.pool.Query(context.Background(), `SELECT t.id::text, t.amount, t.currency, t.occurred_at,
		COALESCE(m.canonical_name,''), COALESCE(c.name,'Lainnya'), COALESCE(t.note,''), t.source, t.status
		FROM transactions t LEFT JOIN merchants m ON m.id=t.merchant_id LEFT JOIN categories c ON c.id=t.category_id
		WHERE t.user_id=$1 AND t.deleted_at IS NULL ORDER BY t.occurred_at DESC`, uid)
	if err != nil {
		return []Transaction{}
	}
	defer rows.Close()
	var out []Transaction
	for rows.Next() {
		var t Transaction
		var id string
		if err := rows.Scan(&id, &t.Amount, &t.Currency, &t.OccurredAt, &t.Merchant, &t.Category, &t.Note, &t.Source, &t.Status); err == nil {
			t.ID = id
			out = append(out, t)
		}
	}
	if out == nil {
		out = []Transaction{}
	}
	return out
}

// ---- create ----

type CreateInput struct {
	Amount     int64
	Currency   string
	Category   string
	Merchant   string
	Note       string
	OccurredAt time.Time
	Source     string
}

func (s *Store) Create(in CreateInput, uid string) (Transaction, *Transaction) {
	if in.Currency == "" {
		in.Currency = "IDR"
	}
	if in.OccurredAt.IsZero() {
		in.OccurredAt = time.Now()
	}
	if in.Source == "" {
		in.Source = "manual"
	}
	return s.createPG(context.Background(), in, uid)
}

func (s *Store) createPG(ctx context.Context, in CreateInput, uid string) (Transaction, *Transaction) {
	catID, catName := s.resolveCategory(ctx, uid, in.Category)
	merchID, merchName := s.resolveMerchant(ctx, uid, in.Merchant, catID)
	// auto-kategori: rule merchant→kategori bila user tidak memilih eksplisit
	if in.Category == "" {
		if rc := s.ruleCategory(ctx, uid, merchName); rc != nil {
			catID, catName = rc, s.categoryName(ctx, rc)
		}
	}
	id, _ := uuid.NewV7()
	var dupID *string
	// rekonsiliasi: manual mirip ±1 hari sudah ada?
	_ = s.pool.QueryRow(ctx, `SELECT id::text FROM transactions
		WHERE user_id=$1 AND deleted_at IS NULL AND status='confirmed'
		AND amount=$2 AND ABS(EXTRACT(EPOCH FROM (occurred_at-$3)))<=86400
		ORDER BY occurred_at DESC LIMIT 1`, uid, in.Amount, in.OccurredAt.UTC()).Scan(&dupID)
	err := s.pool.QueryRow(ctx, `INSERT INTO transactions
		(id, user_id, amount, currency, occurred_at, merchant_id, category_id, note, source, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'confirmed') RETURNING id::text`,
		id.String(), uid, in.Amount, in.Currency, in.OccurredAt.UTC(),
		merchID, catID, in.Note, in.Source).Scan(&id)
	_ = id
	if err != nil {
		return Transaction{}, nil
	}
	t := Transaction{ID: id.String(), Amount: in.Amount, Currency: in.Currency,
		OccurredAt: in.OccurredAt, Merchant: merchName, Category: catName,
		Note: in.Note, Source: in.Source, Status: "confirmed"}
	if dupID != nil {
		dup := Transaction{ID: *dupID}
		return t, &dup
	}
	return t, nil
}

// ---- update / delete ----

func (s *Store) Update(id, note, category, uid string) (Transaction, bool) {
	ctx := context.Background()
	var catID any
	if category != "" {
		c, _ := s.resolveCategory(ctx, uid, category)
		catID = c
		// koreksi user jadi aturan merchant→kategori (PLAN §4.7)
		var merch string
		_ = s.pool.QueryRow(ctx, `SELECT COALESCE(m.canonical_name,'') FROM transactions t
			LEFT JOIN merchants m ON m.id=t.merchant_id WHERE t.id=$1::uuid`, id).Scan(&merch)
		if merch != "" {
			_, _ = s.pool.Exec(ctx, `INSERT INTO rules (user_id, match_type, pattern, category_id)
				VALUES ($1,'merchant',$2,$3) ON CONFLICT (user_id, match_type, pattern)
				DO UPDATE SET category_id=EXCLUDED.category_id`, uid, normalizeMerchant(merch), catID)
		}
	}
	var t Transaction
	var tid string
	err := s.pool.QueryRow(ctx, `UPDATE transactions SET
		note=CASE WHEN $3::text IS NULL THEN note ELSE $3 END,
		category_id=CASE WHEN $4::uuid IS NULL THEN category_id ELSE $4::uuid END
		WHERE id=$1::uuid AND user_id=$2 AND deleted_at IS NULL
		RETURNING id::text, amount, currency, occurred_at, COALESCE(note,''), source, status`,
		id, uid, nullIfEmpty(note), catID).Scan(&tid, &t.Amount, &t.Currency, &t.OccurredAt, &t.Note, &t.Source, &t.Status)
	if err != nil {
		return Transaction{}, false
	}
	t.ID = tid
	_ = s.pool.QueryRow(ctx, `SELECT COALESCE(m.canonical_name,''), COALESCE(c.name,'Lainnya') FROM transactions t
		LEFT JOIN merchants m ON m.id=t.merchant_id LEFT JOIN categories c ON c.id=t.category_id
		WHERE t.id=$1::uuid`, id).Scan(&t.Merchant, &t.Category)
	return t, true
}

func (s *Store) Delete(id, uid string) bool {
	ct, err := s.pool.Exec(context.Background(), `UPDATE transactions SET deleted_at=now()
		WHERE id=$1::uuid AND user_id=$2 AND deleted_at IS NULL`, id, uid)
	return err == nil && ct.RowsAffected() > 0
}

// Restore mengurungkan hapus (undo).
func (s *Store) Restore(id, uid string) bool {
	ct, err := s.pool.Exec(context.Background(), `UPDATE transactions SET deleted_at=NULL
		WHERE id=$1::uuid AND user_id=$2 AND deleted_at IS NOT NULL`, id, uid)
	return err == nil && ct.RowsAffected() > 0
}

// ---- summary / report ----

type CatTotal struct {
	Name  string `json:"name"`
	Total int64  `json:"total"`
}

func monthRange(month string, now time.Time) (time.Time, time.Time) {
	if len(month) == 7 {
		if t, err := time.Parse("2006-01", month); err == nil {
			return t, t.AddDate(0, 1, 0).Add(-time.Second)
		}
	}
	y, m, _ := now.Date()
	return time.Date(y, m, 1, 0, 0, 0, 0, now.Location()),
		time.Date(y, m, 1, 0, 0, 0, 0, now.Location()).AddDate(0, 1, 0).Add(-time.Second)
}

func (s *Store) Summary(month, uid string) (int64, []CatTotal, []map[string]any, []CatTotal) {
	now := time.Now()
	start, end := monthRange(month, now)
	ctx := context.Background()
	var total int64
	_ = s.pool.QueryRow(ctx, `SELECT COALESCE(SUM(amount),0) FROM transactions
		WHERE user_id=$1 AND deleted_at IS NULL AND status='confirmed' AND occurred_at BETWEEN $2 AND $3`,
		uid, start.UTC(), end.UTC()).Scan(&total)
	rows, _ := s.pool.Query(ctx, `SELECT COALESCE(c.name,'Lainnya'), COALESCE(SUM(t.amount),0) FROM transactions t
		LEFT JOIN categories c ON c.id=t.category_id
		WHERE t.user_id=$1 AND t.deleted_at IS NULL AND t.status='confirmed' AND t.occurred_at BETWEEN $2 AND $3
		GROUP BY 1 ORDER BY 2 DESC`, uid, start.UTC(), end.UTC())
	var cats []CatTotal
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var c CatTotal
			if err := rows.Scan(&c.Name, &c.Total); err == nil {
				cats = append(cats, c)
			}
		}
	}
	if cats == nil {
		cats = []CatTotal{}
	}
	drows, _ := s.pool.Query(ctx, `SELECT to_char(occurred_at,'YYYY-MM-DD'), COALESCE(SUM(amount),0) FROM transactions
		WHERE user_id=$1 AND deleted_at IS NULL AND status='confirmed' AND occurred_at BETWEEN $2 AND $3
		GROUP BY 1 ORDER BY 1`, uid, start.UTC(), end.UTC())
	byDay := map[string]int64{}
	if drows != nil {
		defer drows.Close()
		for drows.Next() {
			var d string
			var v int64
			if err := drows.Scan(&d, &v); err == nil {
				byDay[d] = v
			}
		}
	}
	mrows, _ := s.pool.Query(ctx, `SELECT COALESCE(m.canonical_name,'-'), COALESCE(SUM(t.amount),0) FROM transactions t
		LEFT JOIN merchants m ON m.id=t.merchant_id
		WHERE t.user_id=$1 AND t.deleted_at IS NULL AND t.status='confirmed' AND t.occurred_at BETWEEN $2 AND $3
		GROUP BY 1 ORDER BY 2 DESC LIMIT 5`, uid, start.UTC(), end.UTC())
	var top []CatTotal = []CatTotal{}
	if mrows != nil {
		defer mrows.Close()
		for mrows.Next() {
			var c CatTotal
			if err := mrows.Scan(&c.Name, &c.Total); err == nil {
				top = append(top, c)
			}
		}
	}
	if top == nil {
		top = []CatTotal{}
	}
	return total, cats, dayList(byDay, start, end), top
}

// ---- categories ----

func DefaultCategories() []string {
	return []string{"Makanan", "Transport", "Belanja", "Tagihan", "Hiburan", "Kesehatan", "Transfer", "Lainnya"}
}

func (s *Store) Categories(uid string) []string {
	rows, err := s.pool.Query(context.Background(), `SELECT name FROM categories WHERE user_id=$1 ORDER BY name`, uid)
	if err != nil {
		return DefaultCategories()
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err == nil {
			out = append(out, n)
		}
	}
	if len(out) == 0 {
		return DefaultCategories()
	}
	return out
}

func (s *Store) CreateCategory(name, uid string) bool {
	if name == "" {
		return false
	}
	_, err := s.pool.Exec(context.Background(),
		`INSERT INTO categories (user_id, name) VALUES ($1,$2) ON CONFLICT DO NOTHING`, uid, name)
	return err == nil
}

// ---- helpers internal ----

func (s *Store) resolveCategory(ctx context.Context, uid, name string) (any, string) {
	if name == "" {
		name = "Lainnya"
	}
	var id string
	err := s.pool.QueryRow(ctx, `SELECT id FROM categories WHERE user_id=$1 AND name=$2`, uid, name).Scan(&id)
	if err != nil {
		_ = s.pool.QueryRow(ctx, `INSERT INTO categories (user_id, name) VALUES ($1,$2)
			ON CONFLICT (user_id, name) DO UPDATE SET name=EXCLUDED.name RETURNING id`, uid, name).Scan(&id)
	}
	return id, name
}

func (s *Store) categoryName(ctx context.Context, id any) string {
	var n string
	_ = s.pool.QueryRow(ctx, `SELECT name FROM categories WHERE id=$1`, id).Scan(&n)
	return orDefault(n, "Lainnya")
}

func (s *Store) ruleCategory(ctx context.Context, uid, merchant string) any {
	if merchant == "" {
		return nil
	}
	var id string
	if err := s.pool.QueryRow(ctx, `SELECT category_id FROM rules
		WHERE user_id=$1 AND match_type='merchant' AND pattern=$2`, uid, normalizeMerchant(merchant)).Scan(&id); err == nil {
		return id
	}
	return nil
}

func (s *Store) resolveMerchant(ctx context.Context, uid, raw string, catID any) (any, string) {
	name := normalizeMerchant(raw)
	if name == "" {
		return nil, ""
	}
	var id string
	// 1. alias / canonical mirip (pg_trgm)
	err := s.pool.QueryRow(ctx, `SELECT m.id, m.canonical_name FROM merchants m
		LEFT JOIN merchant_aliases a ON a.merchant_id=m.id
		WHERE m.user_id=$1 AND (m.canonical_name ILIKE $2 OR a.alias ILIKE $2)
		ORDER BY SIMILARITY(COALESCE(a.alias,m.canonical_name),$3) DESC LIMIT 1`,
		uid, name, name).Scan(&id, &name)
	if err == nil {
		return id, name
	}
	// 2. buat baru + alias mentah
	nid, _ := uuid.NewV7()
	if err := s.pool.QueryRow(ctx, `INSERT INTO merchants (id, user_id, canonical_name, default_category_id)
		VALUES ($1,$2,$3,$4) RETURNING id`, nid.String(), uid, name, catID).Scan(&id); err != nil {
		return nil, name
	}
	if !strings.EqualFold(raw, name) && raw != "" {
		_, _ = s.pool.Exec(ctx, `INSERT INTO merchant_aliases (merchant_id, alias) VALUES ($1,$2) ON CONFLICT DO NOTHING`, id, raw)
	}
	return id, name
}

// NormalizePublic menormalkan nama merchant ("GRAB*TRIP 123" → "Grab").
// Diekspos untuk modul extraction (aturan yang sama di semua jalur).
func NormalizePublic(raw string) string { return normalizeMerchant(raw) }
func normalizeMerchant(raw string) string {
	r := strings.ToUpper(strings.TrimSpace(raw))
	if r == "" {
		return ""
	}
	// potong di pemisah umum, ambil token alfa pertama yang bermakna
	for _, sep := range []string{"*", "#", "-", "/", "|", "@"} {
		if i := strings.Index(r, sep); i > 0 {
			r = r[:i]
		}
	}
	fields := strings.FieldsFunc(r, func(c rune) bool { return c < 'A' || c > 'Z' })
	if len(fields) == 0 {
		return toTitle(strings.TrimSpace(raw))
	}
	known := map[string]string{
		"GRAB": "Grab", "GOJEK": "Gojek", "GOPAY": "GoPay", "OVO": "OVO", "DANA": "DANA",
		"SHOPEE": "Shopee", "TOKOPEDIA": "Tokopedia", "TRAVELOKA": "Traveloka",
		"BCA": "BCA", "MANDIRI": "Mandiri", "BNI": "BNI", "BRI": "BRI", "JAGO": "Jago", "SEABANK": "SeaBank",
	}
	// cari token dikenal dulu, kalau tidak ada pakai token alfa terpanjang
	best := ""
	for _, f := range fields {
		if len(f) < 3 {
			continue
		}
		if n, ok := known[f]; ok {
			return n
		}
		if len(f) > len(best) {
			best = f
		}
	}
	if best == "" {
		return toTitle(strings.TrimSpace(raw))
	}
	if n, ok := known[best]; ok {
		return n
	}
	l := strings.ToLower(best)
	return strings.ToUpper(l[:1]) + l[1:]
}

// toTitle: Sentence case aman (mengganti strings.Title yang deprecated).
func toTitle(s string) string {
	if s == "" {
		return s
	}
	l := strings.ToLower(s)
	return strings.ToUpper(l[:1]) + l[1:]
}

func EnsureDevUser(ctx context.Context, pool *pgxpool.Pool) string {
	var id string
	_ = pool.QueryRow(ctx, `INSERT INTO users (google_sub, email, name)
		VALUES ('dev','dev@spendly.local','Pengguna Spendly')
		ON CONFLICT (google_sub) DO UPDATE SET email=EXCLUDED.email
		RETURNING id::text`).Scan(&id)
	for _, c := range DefaultCategories() {
		_, _ = pool.Exec(ctx, `INSERT INTO categories (user_id, name) VALUES ($1,$2) ON CONFLICT DO NOTHING`, id, c)
	}
	return id
}

func catList(m map[string]int64) []CatTotal {
	out := make([]CatTotal, 0, len(m))
	for k, v := range m {
		out = append(out, CatTotal{Name: k, Total: v})
	}
	return out
}

func dayList(m map[string]int64, start, end time.Time) []map[string]any {
	var out []map[string]any
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		k := d.Format("2006-01-02")
		out = append(out, map[string]any{"label": d.Format("02 Jan"), "total": m[k]})
	}
	return out
}

func pageArgs(page, limit int) (int, int) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if page <= 0 {
		page = 1
	}
	return limit, (page - 1) * limit
}

func orDefault(v, fb string) string {
	if v == "" {
		return fb
	}
	return v
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	neg := i < 0
	if neg {
		i = -i
	}
	var b [20]byte
	p := len(b)
	for i > 0 {
		p--
		b[p] = byte('0' + i%10)
		i /= 10
	}
	if neg {
		p--
		b[p] = '-'
	}
	return string(b[p:])
}
