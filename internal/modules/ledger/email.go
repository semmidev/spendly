package ledger

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"time"

	"github.com/google/uuid"
)

// EmailInput: transaksi dari ekstraksi email (PLAN §4–5).
type EmailInput struct {
	Amount      int64
	Currency    string
	OccurredAt  time.Time
	Merchant    string
	Category    string
	Source      string // payment_source: "BCA ****1234"
	Note        string
	RawEmailID  string
	ReferenceNo string
	Fingerprint string
	Status      string // confirmed | needs_review | ignored
	DuplicateOf string
	Confidence  float64
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// Fingerprint dedup tingkat transaksi (PLAN §5): user+nominal+currency+ref.
func Fingerprint(userID string, amount int64, currency, ref string) string {
	if ref == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(userID + "|" + itoa64(amount) + "|" + currency + "|" + ref))
	return hex.EncodeToString(sum[:])
}

func itoa64(v int64) string { return strconv.FormatInt(v, 10) }

// CreateEmail: idempoten. Bila raw_email_id diberikan, upsert per email
// (satu email = maksimal satu transaksi) sehingga proses ulang tidak
// menduplikasi. Tanpa raw_email_id, dedup via fingerprint UNIQUE.
// Transaksi yang sudah dihapus user (Sampah) TIDAK PERNAH dihidupkan lagi:
// pemrosesan ulang email yang sama di-skip agar yang dihapus tetap hilang.
// Return (id, true) bila baris dibuat/diperbarui; ("", false) bila dianggap
// duplikat atau di-skip karena sudah dihapus.
func (s *Store) CreateEmail(in EmailInput, uid string) (string, bool) {
	ctx := context.Background()
	catID, catName := s.resolveCategory(ctx, uid, in.Category)
	_ = catName
	merchID, merchName := s.resolveMerchant(ctx, uid, in.Merchant, catID)
	_ = merchName
	if in.Category == "" {
		if rc := s.ruleCategory(ctx, uid, merchName); rc != nil {
			catID = rc
		}
	}
	id, _ := uuid.NewV7()
	status := in.Status
	if status == "" {
		status = "confirmed"
	}

	// Jalur email: upsert berdasarkan raw_email_id (uniqueness dijamin index).
	// Baris yang sudah dihapus user di-skip — jangan hidupkan lagi.
	if in.RawEmailID != "" {
		var wasDeleted bool
		_ = s.pool.QueryRow(ctx, `SELECT true FROM transactions
			WHERE raw_email_id=$1::uuid AND user_id=$2 AND deleted_at IS NOT NULL`,
			in.RawEmailID, uid).Scan(&wasDeleted)
		if wasDeleted {
			return "", false
		}
		var out string
		err := s.pool.QueryRow(ctx, `INSERT INTO transactions
			(id, user_id, amount, currency, occurred_at, merchant_id, category_id,
			 payment_source, note, source, raw_email_id, reference_no, fingerprint,
			 status, duplicate_of, confidence)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'email',$10::uuid,$11,$12,$13,$14::uuid,$15)
			ON CONFLICT (raw_email_id) WHERE raw_email_id IS NOT NULL DO UPDATE SET
				amount=EXCLUDED.amount, currency=EXCLUDED.currency, occurred_at=EXCLUDED.occurred_at,
				merchant_id=EXCLUDED.merchant_id, category_id=EXCLUDED.category_id,
				payment_source=EXCLUDED.payment_source, note=EXCLUDED.note,
				reference_no=EXCLUDED.reference_no, fingerprint=EXCLUDED.fingerprint,
				status=EXCLUDED.status, duplicate_of=EXCLUDED.duplicate_of,
				confidence=EXCLUDED.confidence
			RETURNING id::text`,
			id.String(), uid, in.Amount, in.Currency, in.OccurredAt.UTC(),
			merchID, catID, nullStr(in.Source), in.Note,
			nullStr(in.RawEmailID), nullStr(in.ReferenceNo), nullStr(in.Fingerprint),
			status, nullStr(in.DuplicateOf), in.Confidence).Scan(&out)
		if err == nil && out != "" {
			return out, true
		}
		// Gagal (mis. bentrok fingerprint unik, termasuk dengan baris yang
		// sudah dihapus): skip, jangan insert baris baru untuk email ini.
		return "", false
	}

	// Tanpa raw_email_id: dedup via fingerprint UNIQUE (baris terhapus ikut
	// menahan fingerprint sehingga tidak bisa hidup lagi via jalur ini).
	var out string
	err := s.pool.QueryRow(ctx, `INSERT INTO transactions
		(id, user_id, amount, currency, occurred_at, merchant_id, category_id,
		 payment_source, note, source, raw_email_id, reference_no, fingerprint,
		 status, duplicate_of, confidence)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'email',$10::uuid,$11,$12,$13,$14::uuid,$15)
		ON CONFLICT (fingerprint) DO NOTHING RETURNING id::text`,
		id.String(), uid, in.Amount, in.Currency, in.OccurredAt.UTC(),
		merchID, catID, nullStr(in.Source), in.Note,
		nullStr(in.RawEmailID), nullStr(in.ReferenceNo), nullStr(in.Fingerprint),
		status, nullStr(in.DuplicateOf), in.Confidence).Scan(&out)
	if err == nil && out != "" {
		return out, true
	}
	return "", false
}

// FindDuplicate: nominal sama + waktu ±10 mnt + merchant mirip (PLAN §5).
func (s *Store) FindDuplicate(uid string, amount int64, at time.Time, merchant string) string {
	var id string
	_ = s.pool.QueryRow(context.Background(), `SELECT t.id::text FROM transactions t
		LEFT JOIN merchants m ON m.id=t.merchant_id
		WHERE t.user_id=$1 AND t.deleted_at IS NULL AND t.status='confirmed' AND t.amount=$2
		AND ABS(EXTRACT(EPOCH FROM (t.occurred_at-$3)))<=600
		AND ($4='' OR m.canonical_name=$4 OR m.canonical_name % $4)
		ORDER BY t.occurred_at DESC LIMIT 1`,
		uid, amount, at.UTC(), merchant).Scan(&id)
	return id
}

// FindManualMatch: input manual nominal sama ±1 hari (rekonsiliasi, PLAN §5).
func (s *Store) FindManualMatch(uid string, amount int64, at time.Time) string {
	var id string
	_ = s.pool.QueryRow(context.Background(), `SELECT id::text FROM transactions
		WHERE user_id=$1 AND deleted_at IS NULL AND status='confirmed' AND source='manual' AND amount=$2
		AND ABS(EXTRACT(EPOCH FROM (occurred_at-$3)))<=86400
		ORDER BY occurred_at DESC LIMIT 1`, uid, amount, at.UTC()).Scan(&id)
	return id
}

// Confirm: review/ignored → confirmed (+ aturan bila kategori diubah).
func (s *Store) Confirm(id, uid, category string) (Transaction, bool) {
	t, ok := s.Update(id, "", category, uid)
	if !ok {
		return Transaction{}, false
	}
	_, _ = s.pool.Exec(context.Background(), `UPDATE transactions SET status='confirmed', duplicate_of=NULL
		WHERE id=$1::uuid AND user_id=$2`, id, uid)
	t.Status = "confirmed"
	return t, true
}

// IgnoreTxn: tandai transaksi sebagai bukan pengeluaran.
func (s *Store) IgnoreTxn(id, uid string) bool {
	ct, err := s.pool.Exec(context.Background(), `UPDATE transactions SET status='ignored'
		WHERE id=$1::uuid AND user_id=$2 AND deleted_at IS NULL`, id, uid)
	return err == nil && ct.RowsAffected() > 0
}

// Merge: gabung src ke dst (pertahankan catatan/kategori dst bila sudah ada),
// lalu hapus src. Keduanya harus milik user.
func (s *Store) Merge(srcID, dstID, uid string) (Transaction, bool) {
	if srcID == "" || dstID == "" || srcID == dstID {
		return Transaction{}, false
	}
	ctx := context.Background()
	var dstNote, srcNote, dstCat, srcCat string
	err := s.pool.QueryRow(ctx, `SELECT COALESCE(note,'') FROM transactions WHERE id=$1::uuid AND user_id=$2`, dstID, uid).Scan(&dstNote)
	if err != nil {
		return Transaction{}, false
	}
	_ = s.pool.QueryRow(ctx, `SELECT COALESCE(note,'') FROM transactions WHERE id=$1::uuid AND user_id=$2`, srcID, uid).Scan(&srcNote)
	_ = dstCat
	_ = srcCat
	if dstNote == "" && srcNote != "" {
		_, _ = s.pool.Exec(ctx, `UPDATE transactions SET note=$3 WHERE id=$1::uuid AND user_id=$2`, dstID, uid, srcNote)
	}
	_, _ = s.pool.Exec(ctx, `UPDATE transactions SET deleted_at=now() WHERE id=$1::uuid AND user_id=$2`, srcID, uid)
	var t Transaction
	var tid string
	err = s.pool.QueryRow(ctx, `SELECT t.id::text, t.amount, t.currency, t.occurred_at,
		COALESCE(m.canonical_name,''), COALESCE(c.name,'Lainnya'), COALESCE(t.note,''), t.source, t.status, COALESCE(t.payment_source,'')
		FROM transactions t LEFT JOIN merchants m ON m.id=t.merchant_id LEFT JOIN categories c ON c.id=t.category_id
		WHERE t.id=$1::uuid`, dstID).Scan(&tid, &t.Amount, &t.Currency, &t.OccurredAt, &t.Merchant, &t.Category, &t.Note, &t.Source, &t.Status, &t.PaymentSource)
	if err != nil {
		return Transaction{}, false
	}
	t.ID = tid
	return t, true
}
