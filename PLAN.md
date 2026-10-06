# Spendly

Spendly adalah aplikasi **pelacak pengeluaran**. Notifikasi transaksi dari bank, e-wallet, dan marketplace yang masuk ke Gmail dibaca otomatis (dengan izin user), dianalisis AI menjadi data terstruktur, lalu dikategorikan. Pengeluaran di luar email dicatat manual.

**Di luar scope:** pemasukan, saldo akun, net worth, hutang-piutang, investasi, shared wallet, OCR struk. Spendly menjawab satu pertanyaan: *"uang saya habis ke mana?"*

## 0. Prinsip

1. **Hanya pengeluaran.** Email pemasukan, OTP, promo, dan newsletter diabaikan.
2. **Hitung di titik belanja, bukan di titik pindah dana.** Top-up e-wallet dan transfer antar rekening sendiri tidak dihitung; pembayaran di merchant yang dihitung. Kalau tidak, pengeluaran terhitung dua kali.
3. **AI mengekstrak, kode menghitung.** AI hanya mengubah teks email jadi field. Semua angka laporan berasal dari SQL.
4. **Izin minimum, transparan.** Hanya email dari sender yang user pilih yang dianalisis, dan user bisa melihat daftarnya.
5. **Aplikasi tetap berguna tanpa Gmail.** Input manual selalu jalan.

---

## 1. Fitur (hanya yang penting)

### MVP
**Auth & Onboarding**
- [x] Login dengan Google (hanya identitas: `openid email profile`)
- [x] Hubungkan Gmail sebagai langkah terpisah (incremental authorization)
- [x] Putus koneksi Gmail kapan saja
- [x] Hapus akun + seluruh data

**Email → Pengeluaran**
- [x] Pilih sender yang boleh dibaca (daftar rekomendasi + "temukan sender" dari 90 hari terakhir)
- [x] Backfill 30/90 hari saat pertama kali terhubung
- [x] Sinkronisasi berkala + tombol "Sync sekarang"
- [x] Ekstraksi AI: nominal, merchant, waktu, referensi, sumber dana, kategori usulan
- [x] Dedup otomatis (email yang sama / transaksi yang sama dari dua email)
- [x] Review queue untuk hasil dengan confidence rendah
- [x] Daftar "Diabaikan" (email yang dianggap bukan pengeluaran), bisa dikoreksi user

**Pencatatan Manual**
- [x] Quick-add (nominal, kategori, merchant, tanggal, catatan)
- [x] Edit / hapus / undo
- [x] Sampah: transaksi terhapus (soft delete) bisa dipulihkan

**Kategori**
- [x] Kategori default Indonesia + kategori custom
- [x] Auto-kategori AI; koreksi user jadi aturan "merchant X → kategori Y"
- [x] Normalisasi merchant ("GRAB*TRIP 123" → "Grab")

**Laporan**
- [x] Dashboard: total bulan ini, per kategori, tren harian, top merchant
- [x] Daftar transaksi dengan filter (tanggal, kategori, sumber, nominal) dan pencarian
- [x] Perbandingan dengan bulan lalu
- [x] Export CSV

### Fase 2 (setelah MVP stabil)
- [ ] Budget bulanan per kategori + alert 80% / 100%
- [ ] Periode custom (mulai tanggal gajian)
- [ ] Ringkasan AI mingguan/bulanan
- [ ] Deteksi langganan otomatis & anomali
- [ ] Banyak mailbox Gmail per user
- [ ] Split transaksi, tag, lampiran

> Aturan: fitur baru masuk hanya jika menjawab "uang habis ke mana?" atau mengurangi usaha mencatat.

---

## 2. Auth & Gmail OAuth

### 2.1 Dua tahap izin
1. **Login Google**: scope dasar saja (`openid email profile`). Identitas disimpan sebagai **`google_sub`**, bukan email, karena email bisa berubah.
2. **Hubungkan Gmail** (dari dalam app, setelah user paham manfaatnya): minta `gmail.readonly` dengan `include_granted_scopes=true`, `access_type=offline`, `prompt=consent`. Meminta izin di konteks yang tepat meningkatkan konversi dan lebih patuh pada kebijakan Google.

Satu client OAuth, dua flow. Login memakai Authorization Code + PKCE + validasi ID token (`go-oidc`). Session = cookie `HttpOnly; Secure; SameSite=Lax` dengan session ID di PostgreSQL, ditambah token CSRF untuk mutasi. Tidak ada password, tidak ada token login yang perlu disimpan.

### 2.2 Penyimpanan token Gmail
- Simpan **refresh token** terenkripsi (AES-256-GCM, envelope encryption; kunci dari KMS/secret manager). Access token cukup di memori.
- Tangani `invalid_grant` (user revoke, ganti password Google, token tidak terpakai lama): tandai koneksi `needs_reauth`, hentikan sync, tampilkan banner "Hubungkan ulang Gmail".

### 2.3 ⚠️ Realitas verifikasi Google (rencanakan sejak awal)
- `gmail.readonly` termasuk **restricted scope**; `gmail.metadata` juga restricted, jadi tidak ada jalan pintas. Rilis publik butuh verifikasi OAuth **dan** asesmen keamanan CASA tahunan oleh pihak ketiga.
- Status **Testing**: maksimal 100 test user, dan refresh token **kedaluwarsa 7 hari** (user harus hubungkan ulang tiap minggu). Status **In production** tanpa verifikasi: refresh token umumnya tidak kedaluwarsa, tapi user melihat layar "unverified app" dan ada batas 100 user baru.
- Rencana: pemakaian pribadi/beta kecil → publish ke *In production* tanpa verifikasi (terima layar peringatan). Publik → anggarkan CASA dan waktu verifikasi sebelum membuka pendaftaran.
- Mitigasi risiko review: simpan data seminimal mungkin, retensi body email pendek, tulis privacy policy dengan jelas (termasuk bahwa teks email diproses penyedia AI), tidak pernah menulis/mengubah/menghapus email (read-only).

---

## 3. Membaca Email

### 3.1 Memilih email yang dibaca
Jangan sedot seluruh inbox. Hanya sender yang diizinkan:

```
from:(bca.co.id OR bankmandiri.co.id OR bni.co.id OR bri.co.id OR jago.com
      OR seabank.co.id OR gopay.co.id OR ovo.id OR dana.id OR shopee.co.id
      OR tokopedia.com OR grab.com OR gojek.com OR traveloka.com)
after:<epoch_backfill_start>
```

- **Sender registry** di DB: daftar rekomendasi (seed) + sender custom per user.
- **"Temukan sender"** saat onboarding: ambil header saja (`format=metadata`: `From`, `Subject`) 90 hari terakhir, kelompokkan per sender, tampilkan sender yang subject-nya mirip transaksi ("pembayaran berhasil", "struk", "transaksi"), lalu **user mencentang** mana yang boleh dibaca. Body email baru dibaca setelah sender disetujui.

### 3.2 Strategi sinkronisasi
| Tahap | Mekanisme |
|---|---|
| Backfill | `users.messages.list` (query di atas) + pagination → `messages.get` batch dengan rate limit per user |
| Incremental | `users.history.list` dari `historyId` terakhir (`messageAdded`), difilter ke sender yang diizinkan |
| Pemicu | **Manual** (tombol "Sync sekarang" / "Scan ulang"). Job async dengan progres real-time (SSE), bisa pause/resume/cancel. Tanpa polling latar. |
| Fallback | Jika `history.list` balas 404 (historyId kadaluarsa) → list ulang berdasarkan tanggal |

Keputusan: **hanya pemicu manual** (klik user) untuk MVP — hemat kuota Gmail/AI dan user tetap pegang kendali kapan email dibaca. Opsi jendela (1 hari, 7 hari, bulan ini, 30/90 hari) dan batas email per sinkronisasi diatur user. Tunda `users.watch`/Pub/Sub dan polling terjadwal sampai ada alasan nyata; karena idempotency sudah ada, menambahkan pemicu nanti hanya soal tambahan.

### 3.3 Pembersihan konten
1. Telusuri MIME tree; ambil `text/plain` bila ada, jika tidak `text/html`.
2. Decode base64url + charset (UTF-8, ISO-8859-1, quoted-printable).
3. HTML → teks (`goquery`): buang `<style>`, `<script>`, tracking pixel, footer disclaimer; **pertahankan struktur tabel** (nominal dan tanggal sering di sana).
4. Simpan header: `Message-ID`, `From`, `Subject`, `Date`, `internalDate`.
5. **Gerbang awal (tanpa AI):** buang email OTP/verifikasi, promo, dan newsletter berdasarkan pola subject/sender. Hemat biaya, dan OTP **tidak pernah** dikirim ke AI.

---

## 4. Analisis Teks dengan AI

### 4.1 Satu panggilan: klasifikasi + ekstraksi
Input: teks bersih (sudah diredaksi) + header + daftar kategori user. Output dipaksa mengikuti JSON schema (structured output / tool use):

```json
{
  "is_expense": true,
  "kind": "purchase | transfer_out | topup_own | refund | income | other",
  "amount_raw": "125.000",
  "currency": "IDR",
  "merchant": "Tokopedia",
  "occurred_at_raw": "03 Okt 2026 14:22 WIB",
  "payment_source": "BCA ****1234",
  "reference_no": "TRX123456",
  "category": "Belanja",
  "confidence": 0.93,
  "reason": "Struk pembayaran pesanan"
}
```

Aturan setelah ekstraksi:
- `is_expense=true` dan `kind` ∈ {`purchase`, `transfer_out`} → jadi transaksi.
- `topup_own`, `income`, `refund`, `other` → status `ignored` (tampil di daftar Diabaikan agar user bisa koreksi). Refund dicatat sebagai bahan evaluasi; penanganan khusus bisa menyusul di fase 2.
- `transfer_out` ke orang lain tetap dihitung sebagai pengeluaran dengan kategori "Transfer", bisa dimatikan user.

### 4.2 Angka dan tanggal diparse di Go
LLM mengembalikan **string persis seperti tercetak** (`amount_raw`, `occurred_at_raw`). Parsing ke integer/`time.Time` dilakukan di Go, supaya format `1.250.000,00` vs `1,250,000.00` dan zona waktu WIB tidak jadi sumber halusinasi. Email bank sering tanpa offset: asumsikan `Asia/Jakarta` bila tidak ada.

### 4.3 Validasi
- Nominal > 0 dan masuk akal; mata uang valid.
- Tanggal tidak di masa depan jauh dan tidak jauh lebih lama dari tanggal email.
- Instruksi prompt: kembalikan `null` untuk field yang tidak jelas, jangan menebak.
- Gagal validasi atau `confidence` < ambang → **review queue**, bukan masuk laporan.
- Prompt injection: isi email adalah data, bukan instruksi. Extractor tidak punya tool dengan efek samping; output hanya divalidasi lewat schema.

### 4.4 Privasi sebelum mengirim ke AI
Redaksi nomor kartu/rekening penuh (sisakan 4 digit terakhir), OTP, alamat, nomor telepon, dan nama lengkap yang tidak diperlukan. Kirim hanya teks hasil bersih, bukan HTML mentah. Cek kebijakan retensi penyedia AI dan cantumkan di privacy policy.

### 4.5 Kontrol biaya
- Model kecil/murah sebagai default (model dikonfigurasi via env); eskalasi ke model lebih besar hanya bila validasi gagal.
- Cache hasil berdasarkan `content_hash`.
- Gerbang awal (3.3) memotong sebagian besar email sebelum menyentuh AI.
- Template parser deterministik untuk sender terbesar bisa ditambahkan **belakangan** sebagai optimasi, dipandu metrik hit-rate per sender. Bukan syarat MVP.
- Catat setiap panggilan (`ai_calls`: fitur, model, versi prompt, token, biaya, latensi).

### 4.6 Evaluasi
Bangun **golden set** 100+ email nyata (dianonimkan) dengan label jawaban, mencakup variasi sender, email pemasukan, top-up, OTP, dan promo. Ukur: akurasi `is_expense`, akurasi nominal/tanggal/merchant, dan tingkat lolos validasi. Jalankan di CI setiap ganti prompt atau model.

### 4.7 Auto-kategori
Berlapis dan murah dulu: (1) rule hasil koreksi user → (2) tabel alias merchant (`pg_trgm`) → (3) kategori usulan dari LLM pada panggilan ekstraksi yang sama. Koreksi user otomatis menambah rule baru.

---

## 5. Anti Baca Dua Kali & Anti Duplikat

| Sumber duplikat | Solusi |
|---|---|
| Backfill dan sync incremental tumpang tindih | `UNIQUE (connection_id, gmail_message_id)` pada `raw_emails` + `INSERT ... ON CONFLICT DO NOTHING` |
| Dua worker menyinkronkan mailbox yang sama | `pg_try_advisory_xact_lock(connection_id)` atau job unik di River |
| Job retry setelah crash | Pipeline idempotent; state machine di `raw_emails.status` |
| `historyId` maju padahal pemrosesan gagal | Cursor dimajukan **hanya** dalam transaksi yang sama dengan commit batch |
| Email yang sama dikirim ulang / diteruskan | `content_hash` dari body ternormalisasi |
| 1 pembelian → 2 email (mis. bayar Grab pakai GoPay: email Grab + email GoPay) | **Dedup tingkat transaksi** |
| Input manual lalu emailnya datang | **Rekonsiliasi manual ↔ email** |

**Dedup tingkat transaksi:**
- Ada `reference_no` → `fingerprint = hash(user_id, amount, currency, reference_no)` dengan `UNIQUE`.
- Tanpa referensi → cocokkan `nominal sama + waktu ±10 menit + merchant mirip`. **Jangan hapus otomatis**: tandai `possible_duplicate`, tautkan ke transaksi asal (`duplicate_of`), user yang memutuskan merge.
- Rekonsiliasi manual: saat transaksi dari email masuk, cari input manual dengan nominal sama dalam ±1 hari; tawarkan merge, pertahankan catatan dan kategori dari input manual.

---

## 6. Tech Stack

| Layer | Pilihan | Alasan |
|---|---|---|
| Backend | Go, **modular monolith** (modul: `identity`, `mailsync`, `extraction`, `ledger`, `reporting`), `chi`, `sqlc` + `pgx` | Batas modul jelas tanpa overhead microservices; SQL type-safe |
| Auth | `golang.org/x/oauth2` + `go-oidc`, session di PostgreSQL | Hanya Google; tanpa password |
| Gmail | `google.golang.org/api/gmail/v1` | Client resmi |
| HTML→teks | `goquery` | Parsing HTML + struktur tabel |
| DB | PostgreSQL (+ `pg_trgm` untuk merchant matching) | Transaksional, JSONB untuk hasil ekstraksi |
| Queue/worker | **River** (Postgres-based) | Enqueue atomik dengan insert data; tanpa infra tambahan |
| Migrasi | goose atau atlas | |
| AI | Claude API (structured output / tool use), model via env | Ekstraksi dan klasifikasi teks |
| Secret | AES-256-GCM envelope (KMS/Vault) | Refresh token Gmail |
| API contract | OpenAPI → `oapi-codegen` + `openapi-typescript` | Tipe FE/BE sinkron |
| Frontend | Vite + React + TypeScript | |
| Data/routing | TanStack Query + TanStack Router | |
| UI | shadcn/ui + Tailwind | |
| Chart | Recharts | |
| Form | react-hook-form + zod | |
| PWA | `vite-plugin-pwa` (installable; offline quick-add opsional) | |
| Observability | OpenTelemetry, Prometheus/Grafana, Sentry | |
| Deploy | Docker (Compose di awal, Kubernetes bila perlu) | |

Tidak dipakai (karena scope ramping): Redis, object storage, `pgvector`, Pub/Sub, passkey/2FA sendiri.

**Uang:** `BIGINT` minor unit + kolom `currency`; tidak ada `float`.

---

## 7. Arsitektur

```
┌───────────┐   OAuth login   ┌───────────────────────────┐        ┌────────────┐
│ React SPA │◀──────────────▶│ Go API (modular monolith) │◀──────▶│ PostgreSQL │
└───────────┘                 └───────┬───────────────────┘        └─────▲──────┘
                                      │ enqueue (satu txn dgn data)      │
 Scheduler (manual / sync-on-open) ───▶                                  │
 Sync-on-open / tombol Sync ──────────▶ River workers ───────────────────┘
                                      │ fetch → clean → gate → redact
                                      │ → extract(AI) → parse → validate
                                      │ → dedup → categorize → ledger
                                      └──▶ Gmail API (read-only) · LLM API
```

### Alur satu email
```
fetched ─▶ gated_out (OTP/promo)            [selesai]
        ─▶ extracting ─▶ ignored            [bukan pengeluaran / top-up / income]
                       ─▶ needs_review      [confidence rendah / validasi gagal]
                       ─▶ parsed ─▶ dedup ─▶ transaction (confirmed)
                       ─▶ failed (retry dengan backoff)
```

### Skema inti
```
users               (id, google_sub UNIQUE, email, name, timezone, created_at)
sessions            (id, user_id, expires_at)
gmail_connections   (id, user_id, google_email, enc_refresh_token, history_id,
                     status[active|needs_reauth|revoked], last_synced_at, backfill_days)
sender_registry     (id, domain, label, is_seed, enabled)
user_senders        (connection_id, sender_domain, allowed)         -- pilihan user
raw_emails          (id, connection_id, gmail_message_id, content_hash,
                     status, ignore_reason, parser_version, error, received_at)
                    UNIQUE (connection_id, gmail_message_id)
extractions         (raw_email_id, model, prompt_version, result_json JSONB,
                     confidence, tokens_in, tokens_out, cost)
categories          (id, user_id, name, icon, color)
merchants           (id, user_id, canonical_name, default_category_id)
merchant_aliases    (merchant_id, alias)                            -- pg_trgm
rules               (user_id, match_type, pattern, category_id)
transactions        (id, user_id, amount BIGINT, currency, occurred_at, merchant_id,
                     category_id, payment_source, note,
                     source[manual|email], raw_email_id?, reference_no?,
                     fingerprint? UNIQUE, status[confirmed|needs_review|ignored],
                     duplicate_of?, confidence?, created_at, deleted_at)
ai_calls            (user_id, feature, model, prompt_version, tokens, cost, latency_ms)
audit_logs
```

Retensi: body email mentah **tidak disimpan** setelah diproses (atau maksimal 7–30 hari bila diperlukan untuk re-parse dan debugging). Yang disimpan: header, `content_hash`, hasil ekstraksi, dan transaksi. `parser_version` memungkinkan re-parse selama body masih tersedia.

### Timezone
Simpan UTC; tampilkan sesuai timezone user (default `Asia/Jakarta`). Email tanpa offset diasumsikan WIB.

### Rate limit Gmail API
Backoff eksponensial + jitter, batching, dan antrean per koneksi supaya satu user tidak menghabiskan kuota proyek.

---

## 8. Keamanan & Privasi

- Scope read-only; Spendly tidak pernah menulis, mengubah, atau menghapus email.
- Refresh token terenkripsi; log tidak boleh memuat isi email atau token.
- Transparansi: halaman "Email yang dibaca" menampilkan sender yang diizinkan dan jumlah email yang diproses.
- Putus Gmail = revoke token di Google + hentikan sync; hapus akun = hapus seluruh data (DB, cache).
- Kepatuhan UU PDP (UU No. 27/2022): consent eksplisit sebelum pemrosesan email dan AI, hak akses/hapus/export data. Konsultasikan privacy policy sebelum rilis publik.
- Rate limit API, validasi input, dependensi dipindai (`govulncheck`, `npm audit`).

---

## 9. Roadmap

1. **Fondasi:** login Google, modul `ledger` (kategori, transaksi manual, edit/hapus), dashboard dasar.
2. **Gmail connect:** OAuth tahap kedua, pemilihan sender, backfill, pembersihan teks, penyimpanan `raw_emails` idempotent.
3. **AI extraction:** prompt + schema, parsing & validasi di Go, review queue, **golden set + evaluasi di CI**.
4. **Sync matang:** incremental `history.list`, pemicu manual + kontrol jendela/limit, dedup transaksi, rekonsiliasi manual, daftar Diabaikan.
5. **Kategori cerdas & laporan:** rule dari koreksi, normalisasi merchant, export CSV.
6. **Fase 2:** budget, ringkasan AI, deteksi langganan/anomali, notifikasi, multi-mailbox.

---

## 10. Keputusan Terbuka & Risiko

- [ ] **Pribadi/beta kecil atau publik?** Menentukan apakah CASA masuk timeline dan siapa menanggung biaya AI
- [ ] Ambang confidence untuk review queue (mulai konservatif, longgarkan dengan data)
- [ ] Perlakuan refund (abaikan di MVP vs kurangi pengeluaran asal)
- [ ] Transfer ke orang lain: dihitung pengeluaran secara default?
- [ ] Retensi body email: nol (langsung buang) vs 7–30 hari untuk re-parse
- [ ] Risiko: sender mengubah template email → AI-first lebih tahan, tapi pantau metrik parse per sender
- [ ] Risiko: biaya AI membengkak → gerbang awal, cache, model kecil, kuota per user
- [ ] Risiko: refresh token Gmail kedaluwarsa (Testing 7 hari, ganti password) → banner reconnect yang jelas

---

## 11. Status Implementasi & Deviasi

MVP (Bagian 1) sudah diimplementasikan. Ringkasan deviasi sadar dari Bagian 6
(tech stack), beserta alasan — semua demi scope ramping:

| PLAN | Implementasi | Alasan |
|---|---|---|
| `sqlc` | `pgx` + SQL langsung | Query masih sedikit; `sqlc` ditambahkan saat query membengkak |
| `River` | Inline bounded, dipicu manual (klik user) | Idempoten sudah ada; River hanya soal pemicu saat volume butuh |
| Claude API | **go-openai** (OpenAI-compatible, `response_format` json_schema) | Structured output matang, base URL bisa OpenRouter/opencode/OpenAI |
| `goquery` | `golang.org/x/net/html` | Sudah pertahankan struktur tabel; goquery di atas library yang sama |
| OpenAPI/oapi-codegen | DTO + zod-like manual | Hindari codegen sampai kontrak stabil |
| TanStack Query/Router | fetch + `react-router-dom` | Aplikasi kecil; Query ditambah bila cache kompleks |
| react-hook-form + zod | kontrol manual | Form sedikit |
| PWA / OTel / Sentry | belum | Fase 2; tidak menghambat MVP |

Sudah sesuai PLAN: modular monolith (`identity, mailsync, extraction, ledger,
reporting`), chi, OAuth Google dua tahap (PKCE + `go-oidc`), sesi cookie
HttpOnly + CSRF, Gmail read-only + incremental `history.list`, gerbang OTP/promo
tanpa AI, redaksi sebelum AI, parsing angka/tanggal di Go, dedup fingerprint +
fuzzy + rekonsiliasi manual, review queue, daftar Diabaikan, rule kategori,
`pg_trgm`, uang `BIGINT`, goose, AES-256-GCM, rate limit + body limit,
`audit_logs`, export CSV, SPA ter-embed.

### Cara menjalankan (SPA satu proses)
```bash
make run          # build frontend → embed → jalankan API+UI di :8080
make dev          # jalankan API memakai dist yang sudah ada
make test         # unit + integrasi (testcontainers, skip bila Docker mati)
make build        # binary bin/api dengan versi ter-inject
```
Frontend tidak perlu dijalankan terpisah; `make run` sudah melayani UI dari
binary (`internal/web/embed.go`).
