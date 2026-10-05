package mailsync

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/semmidev/spendly/internal/platform/apperr"
)

// job: satu sesi sinkronisasi yang bisa dipantau, dijeda, dilanjut, dibatalkan.
type job struct {
	id           string
	userID       string
	connectionID string
	forceDays    int
	maxEmails    int

	mu       sync.Mutex
	progress Progress
	stats    Stats
	paused   bool
	canceled bool
	subs     map[chan Progress]struct{}
	done     chan struct{}
	cancel   context.CancelFunc
	// throttle tulis progres ke DB
	lastPersist time.Time
}

type jobManager struct {
	mu     sync.Mutex
	jobs   map[string]*job
	active map[string]string // connectionID → jobID yang sedang jalan
}

func newJobManager() *jobManager {
	return &jobManager{jobs: map[string]*job{}, active: map[string]string{}}
}

func (j *job) snapshot() Progress {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.progress
}

func (j *job) broadcast(p Progress) {
	j.mu.Lock()
	subs := make([]chan Progress, 0, len(j.subs))
	for ch := range j.subs {
		subs = append(subs, ch)
	}
	j.mu.Unlock()
	for _, ch := range subs {
		// Kirim non-blocking; abaikan bila pelanggan lambat atau channel sudah ditutup.
		safeSend(ch, p)
	}
}

// safeSend: kirim ke channel tanpa panik bila sudah ditutup.
func safeSend(ch chan Progress, p Progress) {
	defer func() { recover() }() //nolint:errcheck
	select {
	case ch <- p:
	default:
	}
}

func (j *job) gate(ctx context.Context) error {
	for {
		j.mu.Lock()
		canceled := j.canceled
		paused := j.paused
		j.mu.Unlock()
		if canceled {
			return context.Canceled
		}
		if !paused {
			return ctx.Err()
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(150 * time.Millisecond):
		}
	}
}

// StartSyncJob: preflight sinkron (validasi), lalu jalankan scan di latar.
func (s *Service) StartSyncJob(ctx context.Context, uid, connectionID string, forceDays, maxEmails int) (string, error) {
	if connectionID == "" {
		return "", apperr.Invalid("belum ada koneksi Gmail — hubungkan dulu di Akun")
	}
	var status string
	if err := s.pool.QueryRow(ctx, `SELECT status FROM gmail_connections WHERE id=$1::uuid AND user_id=$2`,
		connectionID, uid).Scan(&status); err != nil {
		return "", apperr.NotFound("koneksi Gmail tidak ditemukan")
	}
	if status != "active" {
		return "", apperr.Invalid("koneksi Gmail tidak aktif — hubungkan ulang di Akun")
	}
	if len(s.AllowedDomains(ctx, connectionID)) == 0 {
		return "", apperr.Invalid("belum ada pengirim yang diizinkan — pilih dulu di Pengaturan Gmail")
	}

	m := s.jobs
	m.mu.Lock()
	if jid, ok := m.active[connectionID]; ok {
		if existing, ok := m.jobs[jid]; ok {
			// Baca status langsung tanpa snapshot() agar tidak dead-lock
			// (kita sudah pegang m.mu; j.mu tidak perlu di sini karena
			// goroutine job baru akan dibuat setelah m.mu dilepas).
			existing.mu.Lock()
			st := existing.progress.Status
			existing.mu.Unlock()
			if st == "running" {
				m.mu.Unlock()
				return "", apperr.Conflict("sinkronisasi sedang berjalan untuk koneksi ini")
			}
		}
	}
	id := uuid.NewString()
	if _, err := s.pool.Exec(ctx, `INSERT INTO sync_jobs (id, user_id, connection_id, status, scan_limit)
		VALUES ($1::uuid,$2,$3::uuid,'running',$4)`, id, uid, connectionID, maxEmails); err != nil {
		return "", err
	}
	j := &job{
		id: id, userID: uid, connectionID: connectionID,
		forceDays: forceDays, maxEmails: maxEmails,
		progress: Progress{Status: "running", Message: "menyiapkan"},
		subs:     map[chan Progress]struct{}{},
		done:     make(chan struct{}),
	}
	m.jobs[id] = j
	m.active[connectionID] = id
	m.mu.Unlock()

	jobCtx, cancel := context.WithCancel(context.Background())
	j.cancel = cancel
	go s.runJob(jobCtx, j)
	return id, nil
}

func (s *Service) runJob(ctx context.Context, j *job) {
	defer close(j.done)

	report := func(p Progress) {
		j.mu.Lock()
		if p.Mode != "" {
			j.progress.Mode = p.Mode
		}
		j.progress.Processed = p.Processed
		if p.Total > 0 {
			j.progress.Total = p.Total
		}
		j.progress.New = p.New
		j.progress.Gated = p.Gated
		j.progress.Current = p.Current
		if p.Message != "" {
			j.progress.Message = p.Message
		}
		if j.progress.Status == "paused" || j.progress.Status == "canceling" {
			// jangan timpa status kontrol user
		} else {
			j.progress.Status = "running"
		}
		snap := j.progress
		j.mu.Unlock()
		j.broadcast(snap)
		s.persistProgress(j, snap, false)
	}

	stats, err := s.runSync(ctx, j.userID, j.connectionID, j.forceDays, j.maxEmails, func() error { return j.gate(ctx) }, report)

	j.mu.Lock()
	j.stats = stats
	j.progress.Extracted = stats.Extracted
	switch {
	case j.canceled || errors.Is(err, context.Canceled):
		j.progress.Status = "canceled"
		j.progress.Message = "dibatalkan"
	case err != nil:
		j.progress.Status = "error"
		j.progress.Message = err.Error()
	default:
		j.progress.Status = "done"
		j.progress.Message = "selesai"
	}
	final := j.progress
	j.mu.Unlock()
	j.broadcast(final)
	s.persistProgress(j, final, true)

	m := s.jobs
	m.mu.Lock()
	if m.active[j.connectionID] == j.id {
		delete(m.active, j.connectionID)
	}
	m.mu.Unlock()

	// simpan sementara agar klien bisa membaca status akhir
	time.AfterFunc(15*time.Minute, func() {
		m.mu.Lock()
		delete(m.jobs, j.id)
		m.mu.Unlock()
	})
}

func (s *Service) getJob(jobID, uid string) (*job, bool) {
	s.jobs.mu.Lock()
	defer s.jobs.mu.Unlock()
	j, ok := s.jobs.jobs[jobID]
	if !ok || j.userID != uid {
		return nil, false
	}
	return j, true
}

// ActiveSyncJob mengembalikan job yang masih berjalan/dijeda untuk koneksi ini
// (agar klien yang navigasi menjauh lalu kembali bisa memulihkan indikator).
func (s *Service) ActiveSyncJob(ctx context.Context, uid, connectionID string) (string, bool) {
	var owner string
	if err := s.pool.QueryRow(ctx, `SELECT user_id::text FROM gmail_connections WHERE id=$1::uuid`, connectionID).Scan(&owner); err != nil || owner != uid {
		return "", false
	}
	m := s.jobs
	m.mu.Lock()
	id, ok := m.active[connectionID]
	if !ok {
		m.mu.Unlock()
		return "", false
	}
	j, ok := m.jobs[id]
	m.mu.Unlock()
	if !ok {
		return "", false
	}
	// Baca status dengan j.mu untuk menghindari data race.
	j.mu.Lock()
	st := j.progress.Status
	j.mu.Unlock()
	if st != "running" && st != "paused" {
		return "", false
	}
	return id, true
}

// persistProgress menulis progres ke DB (throttle 2 detik; final selalu ditulis).
func (s *Service) persistProgress(j *job, p Progress, force bool) {
	j.mu.Lock()
	if !force && time.Since(j.lastPersist) < 2*time.Second && p.Status == "running" {
		j.mu.Unlock()
		return
	}
	j.lastPersist = time.Now()
	j.mu.Unlock()
	_, _ = s.pool.Exec(context.Background(), `UPDATE sync_jobs
		SET status=$2, mode=$3, processed=$4, total=$5, new_count=$6, gated_count=$7,
		    extracted_count=$8, current=$9, message=$10, updated_at=now(),
		    finished_at=CASE WHEN $2 IN ('done','error','canceled') THEN COALESCE(finished_at, now()) ELSE finished_at END
		WHERE id=$1::uuid`,
		j.id, p.Status, p.Mode, p.Processed, p.Total, p.New, p.Gated, p.Extracted, p.Current, p.Message)
}

// RecoverStaleJobs menandai job yang tertinggal running/paused (mis. server
// restart) sebagai error agar tidak menggantung selamanya.
func (s *Service) RecoverStaleJobs(ctx context.Context) (int64, error) {
	ct, err := s.pool.Exec(ctx, `UPDATE sync_jobs
		SET status='error', message='server dimatikan saat sync berjalan', finished_at=now(), updated_at=now()
		WHERE status IN ('running','paused','canceling')`)
	if err != nil {
		return 0, err
	}
	return ct.RowsAffected(), nil
}

// SyncJobProgress mengembalikan snapshot progres job (memori dulu, lalu DB).
func (s *Service) SyncJobProgress(jobID, uid string) (Progress, bool) {
	j, ok := s.getJob(jobID, uid)
	if ok {
		return j.snapshot(), true
	}
	// fallback DB (job selesai / server restart, tapi baris masih ada)
	var p Progress
	var status, mode, current, message string
	var processed, total, newC, gatedC, extC int
	err := s.pool.QueryRow(context.Background(), `SELECT status, mode, processed, total,
		new_count, gated_count, extracted_count, current, message
		FROM sync_jobs WHERE id=$1::uuid AND user_id=$2`, jobID, uid).
		Scan(&status, &mode, &processed, &total, &newC, &gatedC, &extC, &current, &message)
	if err != nil {
		return Progress{}, false
	}
	p = Progress{Status: status, Mode: mode, Processed: processed, Total: total,
		New: newC, Gated: gatedC, Extracted: extC, Current: current, Message: message}
	return p, true
}

// SyncJobStats mengembalikan hasil akhir (bila sudah selesai).
func (s *Service) SyncJobStats(jobID, uid string) (Stats, bool) {
	j, ok := s.getJob(jobID, uid)
	if ok {
		j.mu.Lock()
		defer j.mu.Unlock()
		return j.stats, true
	}
	var st Stats
	var days int
	err := s.pool.QueryRow(context.Background(), `SELECT new_count, gated_count, extracted_count, scan_limit, days
		FROM sync_jobs WHERE id=$1::uuid AND user_id=$2`, jobID, uid).
		Scan(&st.New, &st.Gated, &st.Extracted, &st.Limit, &days)
	if err != nil {
		return Stats{}, false
	}
	st.BackfillDays = days
	return st, true
}

func (s *Service) setJobControl(jobID, uid, action string) error {
	j, ok := s.getJob(jobID, uid)
	if !ok {
		// Baris DB tertinggal aktif tanpa worker (mis. restart di tengah jeda):
		// tandai error agar tidak menggantung, minta user mulai ulang.
		if s.pool != nil {
			var st string
			if err := s.pool.QueryRow(context.Background(), `SELECT status FROM sync_jobs
				WHERE id=$1::uuid AND user_id=$2`, jobID, uid).Scan(&st); err == nil &&
				(st == "running" || st == "paused") {
				_, _ = s.pool.Exec(context.Background(), `UPDATE sync_jobs SET status='error',
					message='job tidak aktif di server ini — mulai ulang sinkronisasi',
					finished_at=now(), updated_at=now() WHERE id=$1::uuid`, jobID)
				return apperr.Conflict("job tidak aktif — mulai ulang sinkronisasi")
			}
		}
		return apperr.NotFound("job tidak ditemukan")
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	switch action {
	case "pause":
		if j.progress.Status != "running" {
			return apperr.Conflict("job tidak sedang berjalan")
		}
		j.paused = true
		j.progress.Status = "paused"
		j.progress.Message = "dijeda"
	case "resume":
		if j.progress.Status != "paused" {
			return apperr.Conflict("job tidak sedang dijeda")
		}
		j.paused = false
		j.progress.Status = "running"
		j.progress.Message = "dilanjutkan"
	case "cancel":
		j.canceled = true
		j.paused = false
		j.progress.Status = "canceling"
		j.progress.Message = "menghentikan…"
		if j.cancel != nil {
			j.cancel()
		}
	default:
		return apperr.Invalid("aksi tidak dikenal")
	}
	snap := j.progress
	go j.broadcast(snap)
	return nil
}

func (s *Service) PauseSyncJob(jobID, uid string) error { return s.setJobControl(jobID, uid, "pause") }
func (s *Service) ResumeSyncJob(jobID, uid string) error {
	return s.setJobControl(jobID, uid, "resume")
}
func (s *Service) CancelSyncJob(jobID, uid string) error {
	return s.setJobControl(jobID, uid, "cancel")
}

// SubscribeSyncJob: kanal progres + snapshot awal + fungsi unsubscribe.
func (s *Service) SubscribeSyncJob(jobID, uid string) (<-chan Progress, func(), bool) {
	j, ok := s.getJob(jobID, uid)
	if !ok {
		return nil, nil, false
	}
	ch := make(chan Progress, 8)
	j.mu.Lock()
	j.subs[ch] = struct{}{}
	initial := j.progress
	done := j.progress.Status == "done" || j.progress.Status == "error" || j.progress.Status == "canceled"
	j.mu.Unlock()
	// Kirim snapshot awal setelah lock dilepas agar tidak memblokir.
	safeSend(ch, initial)
	unsub := func() {
		j.mu.Lock()
		delete(j.subs, ch)
		j.mu.Unlock()
	}
	if done {
		// Hapus dulu dari subs sebelum close agar broadcast tidak panik.
		unsub()
		close(ch)
	}
	return ch, unsub, true
}
