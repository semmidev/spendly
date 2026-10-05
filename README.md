<div align="center">

# Spendly

**Pelacak pengeluaran pribadi — tahu uangmu habis ke mana.**

Spendly membaca notifikasi transaksi dari Gmail (dengan izinmu), mengekstraknya
jadi data terstruktur lewat AI, mengategorikan otomatis, dan menyajikan laporan.
Pengeluaran di luar email dicatat manual.

[![Go](https://img.shields.io/badge/Go-1.27-00ADD8?logo=go&logoColor=white)](https://go.dev)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![License](https://img.shields.io/badge/license-MIT-green)](#lisensi)

</div>

---

## Daftar Isi

- [Tentang](#tentang)
- [Fitur](#fitur)
- [Arsitektur](#arsitektur)
- [Tech Stack](#tech-stack)
- [Prasyarat](#prasyarat)
- [Mulai Cepat](#mulai-cepat)
- [Konfigurasi Environment](#konfigurasi-environment)
- [Setup Google OAuth](#setup-google-oauth)
- [Setup Penyedia AI](#setup-penyedia-ai)
- [Struktur Proyek](#struktur-proyek)
- [Ringkasan API](#ringkasan-api)
- [Perintah Make](#perintah-make)
- [Pengujian](#pengujian)
- [Keamanan & Privasi](#keamanan--privasi)
- [Deployment](#deployment)
- [Roadmap](#roadmap)
- [Lisensi](#lisensi)

---

## Tentang

Spendly menjawab satu pertanyaan: **"uang saya habis ke mana?"**

Notifikasi transaksi dari bank, e-wallet, dan marketplace yang masuk ke Gmail
dibaca otomatis, dianalisis AI menjadi data terstruktur, lalu dikategorikan.
Semua angka laporan dihitung di SQL — AI hanya mengekstrak.

**Di luar scope:** pemasukan, saldo akun, net worth, hutang-piutang, investasi,
shared wallet, OCR struk.

### Prinsip

1. **Hanya pengeluaran.** Email pemasukan, OTP, promo, dan newsletter diabaikan.
2. **Hitung di titik belanja, bukan titik pindah dana.** Top-up e-wallet dan
   transfer antar rekening sendiri tidak dihitung; pembayaran di merchant yang dihitung.
3. **AI mengekstrak, kode menghitung.** Semua angka laporan berasal dari SQL.
4. **Izin minimum, transparan.** Hanya email dari pengirim yang user pilih yang dibaca.
5. **Tetap berguna tanpa Gmail.** Input manual selalu jalan.

---

## Fitur

**Auth & Onboarding**
- Login Google (identitas: `openid email profile`), tanpa kata sandi.
- Hubungkan Gmail sebagai langkah terpisah (incremental authorization, `gmail.readonly`).
- Putus koneksi Gmail kapan saja; hapus akun + seluruh data.

**Email → Pengeluaran**
- Pilih pengirim yang boleh dibaca (rekomendasi + "temukan pengirim" 90 hari terakhir).
- Backfill dengan kontrol jendela (1 hari, 7 hari, bulan ini, 30/90 hari) & batas email.
- Sinkronisasi **manual** sebagai *job async* dengan progres real-time (SSE),
  bisa **jeda / lanjut / hentikan**, dan **persisten di DB** (aman antar-device).
- Ekstraksi AI: nominal, merchant, waktu, referensi, sumber dana, kategori, catatan.
- Dedup otomatis (fingerprint referensi + kecocokan nominal/waktu/merchant).
- Review queue untuk hasil ber-confidence rendah; daftar "Diabaikan" yang bisa dikoreksi.

**Pencatatan Manual**
- Quick-add (nominal format Rupiah, kategori, merchant, tanggal, catatan).
- Edit/hapus/undo; pengeluaran berulang (langganan/cicilan).

**Kategori**
- Kategori default Indonesia + custom; auto-kategori AI + rule hasil koreksi;
  normalisasi merchant (`GRAB*TRIP 123` → `Grab`, `pg_trgm`).

**Laporan**
- Dashboard: total bulan ini, per kategori, tren harian, merchant teratas.
- Daftar transaksi: filter tanggal, kategori, nominal; pencarian; grouping per hari/bulan; pagination.
- Perbandingan bulan lalu; export CSV.

---

## Arsitektur

Spendly adalah **modular monolith** Go yang juga menyajikan React SPA yang
di-embed ke dalam binary — satu proses, tanpa dev-server terpisah.

```
┌────────────┐   OAuth / cookie sesi   ┌───────────────────────────┐        ┌────────────┐
│ React SPA  │◀──────────────────────▶│ Go API (modular monolith) │◀──────▶│ PostgreSQL │
│ (embedded) │                        └───────┬───────────────────┘        └─────▲──────┘
└────────────┘                                │ job async (sync_jobs)            │
                                              │ fetch → clean → gate → redact    │
                                              │ → extract(AI) → parse → validate │
                                              │ → dedup → categorize → ledger ───┘
                                              └──▶ Gmail API (read-only) · LLM API
```

**Alur satu email**

```
fetched ─▶ gated_out (OTP/promo)          [selesai]
        ─▶ ignored (topup/income/refund)  [bisa dikoreksi]
        ─▶ needs_review (confidence/validasi gagal)
        ─▶ parsed ─▶ dedup ─▶ transaction (confirmed)
        ─▶ failed (retry dengan backoff)
```

**Modul backend:** `identity`, `mailsync`, `extraction`, `ledger`, `reporting`.

---

## Tech Stack

| Layer | Pilihan |
|---|---|
| Bahasa | Go 1.27 |
| HTTP router | `chi` |
| Database | PostgreSQL 16 + `pg_trgm` |
| Akses DB | `pgx` (pool) |
| Migrasi | `goose` (embedded) |
| Auth | Google OAuth2 + `go-oidc`, sesi cookie HttpOnly di PostgreSQL |
| Gmail | `google.golang.org/api/gmail/v1` (read-only) |
| AI | OpenAI-compatible via `go-openai` (OpenAI, OpenRouter, OpenCode Go/Zen) |
| Secret | AES-256-GCM (refresh token Gmail) |
| Frontend | Vite + React 19 + Tailwind v4 |
| Chart | Recharts |
| State | Zustand |
| Notifikasi | Sonner |
| Deploy | Docker (multi-stage, distroless) + Compose |

---

## Prasyarat

- **Go** 1.27+
- **Bun** (atau Node 20+) untuk build frontend
- **PostgreSQL** 16 (lokal atau Docker)
- **Docker** (opsional, untuk `make db-up` dan test integrasi)
- **Kredensial Google OAuth** (lihat [Setup Google OAuth](#setup-google-oauth))
- **API key penyedia AI** (opsional — tanpa ini, ekstraksi memakai parser lokal)

---

## Mulai Cepat

```bash
# 1. Clone
git clone https://github.com/semmidev/spendly.git
cd spendly

# 2. Siapkan environment
cp .env.example .env
# edit .env: isi DATABASE_URL, GOOGLE_CLIENT_ID/SECRET, AI_API_KEY

# 3. Nyalakan PostgreSQL lokal (Docker)
make db-up

# 4. Jalankan (build SPA + embed + API dalam satu proses)
make run
```

Buka <http://localhost:8080>. Migrasi database berjalan otomatis saat startup.

> Untuk pengembangan cepat tanpa rebuild frontend, gunakan `make dev`
> (memakai `internal/web/dist` yang sudah ada).

### Tanpa Google OAuth (dev lokal)

Jika `GOOGLE_CLIENT_ID` kosong, tersedia login dev di `POST /api/v1/auth/login`
(membuat user `dev@spendly.local`) untuk mencoba UI tanpa menyiapkan OAuth.

---

## Konfigurasi Environment

Semua variabel dibaca dari `.env` (lihat `.env.example`).

| Variabel | Wajib | Default | Keterangan |
|---|---|---|---|
| `APP_ENV` | tidak | `development` | `production` mengaktifkan validasi config ketat + log JSON |
| `APP_PORT` | tidak | `8080` | Port HTTP |
| `APP_NAME` | tidak | `spendly` | Nama service (health/version) |
| `LOG_LEVEL` | tidak | `info` | `debug`\|`info`\|`warn`\|`error` |
| `DATABASE_URL` | **ya** | — | `postgres://user:pass@host:5432/spendly?sslmode=disable` |
| `APP_ENCRYPTION_KEY` | **ya** | dev key | 16/24/32 byte, untuk enkripsi refresh token Gmail |
| `SESSION_SECRET` | **ya** | dev key | ≥ 32 karakter |
| `CORS_ALLOWED_ORIGINS` | tidak | `http://localhost:5173` | Daftar origin dipisah koma |
| `AI_API_KEY` | tidak | — | Kosong → parser deterministik lokal |
| `AI_BASE_URL` | tidak | `https://opencode.ai/zen/go/v1` | Endpoint OpenAI-compatible |
| `AI_MODEL` | tidak | `deepseek-v4.1-flash` | Model ekstraksi |
| `AI_API_MODE` | tidak | `chat` | `chat` (`/chat/completions`) atau `responses` (`/responses`) |
| `GOOGLE_CLIENT_ID` | ya* | — | *Wajib untuk login Google |
| `GOOGLE_CLIENT_SECRET` | ya* | — | *Wajib untuk login Google |
| `GOOGLE_REDIRECT_URL` | tidak | `http://localhost:8080/api/v1/auth/google/callback` | Callback login |
| `FRONTEND_URL` | tidak | kosong | Kosong = SPA satu origin; isi bila FE di-host terpisah |

> Di `APP_ENV=production`, aplikasi menolak start bila `DATABASE_URL`,
> `APP_ENCRYPTION_KEY`, `SESSION_SECRET`, atau kredensial Google tidak aman/kosong.

---

## Setup Google OAuth

Satu OAuth client dipakai untuk **dua flow** (login + Gmail).

1. Buka [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services**.
2. Aktifkan **Gmail API**.
3. **OAuth consent screen**: isi informasi aplikasi.
4. **Credentials → Create Credentials → OAuth client ID → Web application**.
5. Daftarkan **dua Authorized redirect URIs**:

   ```
   http://localhost:8080/api/v1/auth/google/callback
   http://localhost:8080/api/v1/auth/google/callback/gmail
   ```

6. Salin Client ID & Secret ke `.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`).

> `gmail.readonly` adalah *restricted scope*. Rilis publik memerlukan verifikasi
> OAuth + asesmen keamanan CASA. Untuk beta kecil, publish ke *In production*
> tanpa verifikasi (user melihat layar "unverified app").

---

## Setup Penyedia AI

Ekstraksi memakai API **OpenAI-compatible** (`go-openai`), sehingga bisa
diarahkan ke OpenAI, OpenRouter, atau OpenCode Go/Zen.

```env
AI_API_KEY=...
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
AI_API_MODE=chat
```

- `AI_API_MODE=chat` → `POST /chat/completions` (OpenAI, OpenRouter, DeepSeek, dll).
- `AI_API_MODE=responses` → `POST /responses` (mis. Zen `muse-spark*`).

Jika `AI_API_KEY` kosong atau panggilan gagal, Spendly otomatis memakai
**parser deterministik lokal** dan menaruh hasilnya di **review queue** —
aplikasi tetap berfungsi.

---

## Struktur Proyek

```
spendly/
├── cmd/api/main.go              # entrypoint: config, DB wajib, migrasi, graceful shutdown
├── db/
│   ├── migrate.go               # runner goose (embedded)
│   └── migrations/              # skema versioned
├── internal/
│   ├── app/router.go            # wiring chi + timeout per kelompok route + SPA
│   ├── modules/
│   │   ├── identity/            # OAuth Google, sesi, koneksi Gmail
│   │   ├── mailsync/            # sender, sync job async (SSE), clean, gate, redact
│   │   ├── extraction/          # AI structured output, parse Go, dedup, review
│   │   ├── ledger/              # transaksi, kategori, merchant, berulang
│   │   └── reporting/           # dashboard, laporan, CSV
│   ├── provider/
│   │   ├── gmail/               # client Gmail read-only
│   │   └── llm/                 # client OpenAI-compatible
│   ├── platform/                # config, db, web, apperr, middleware, security, audit
│   └── web/embed.go             # SPA embedded (dist)
├── web/                         # frontend React + DESIGN.md
├── compose.yml                  # Postgres + API
├── Dockerfile                   # multi-stage (bun → go → distroless)
└── Makefile
```

---

## Ringkasan API

Semua respons memakai envelope `{ success, message, data, meta?, errors? }`.
Endpoint data memerlukan sesi (cookie) + header CSRF untuk mutasi.

| Area | Endpoint |
|---|---|
| Auth | `GET /auth/google/login`, `GET /auth/google/callback`, `GET /auth/me`, `POST /auth/logout` |
| Gmail | `GET /gmail/connect`, `GET /auth/google/callback/gmail`, `GET/DELETE /gmail/connections`, `PATCH /gmail/connections/{id}` |
| Sender | `GET /senders`, `PUT /senders`, `GET /senders/recommended`, `POST /senders/discover` |
| Sync (job async) | `POST /gmail/sync`, `GET /gmail/sync/active`, `GET /gmail/sync/{id}`, `POST /gmail/sync/{id}/pause\|resume\|cancel`, `GET /gmail/sync/{id}/events` (SSE) |
| Transaksi | `GET/POST /transactions`, `PATCH/DELETE /transactions/{id}`, `POST /transactions/{id}/restore`, `POST /transactions/{id}/merge` |
| Review/Ignored | `GET /review-queue`, `POST /review-queue/{id}/confirm\|ignore`, `GET /ignored`, `POST /ignored/{id}/correct`, `POST /ignored/emails/{id}/reprocess` |
| Kategori | `GET/POST /categories` |
| Berulang | `GET/POST /recurring`, `DELETE /recurring/{id}`, `POST /recurring/{id}/book` |
| Laporan | `GET /dashboard/summary`, `GET /reports/monthly`, `GET /export.csv` |
| Ops | `GET /health/live`, `GET /health/ready`, `GET /version` |

---

## Perintah Make

| Perintah | Fungsi |
|---|---|
| `make run` | Build frontend → embed → jalankan API+UI |
| `make dev` | Jalankan API memakai dist yang ada |
| `make build` | Binary `bin/api` (versi ter-inject via ldflags) |
| `make build-frontend` | Build SPA dan salin ke `internal/web/dist` |
| `make test` | Unit + integrasi (`go test -race`) |
| `make test-pg` | Test integrasi testcontainers (verbose) |
| `make lint` | `go vet` |
| `make fmt` | `gofmt` |
| `make tidy` | `go mod tidy` |
| `make db-up` / `make db-down` | Nyalakan/hentikan PostgreSQL lokal |
| `make clean` | Bersihkan `bin/` dan dist |

---

## Pengujian

```bash
make test        # seluruh paket (unit + integrasi)
make test-pg     # hanya integrasi Postgres (testcontainers)
```

- **Unit**: parser angka/tanggal, gate OTP/promo, redaksi, golden set ekstraksi,
  client LLM (stub), job sync.
- **Integrasi** (`internal/e2e`, `testutil`): menyalakan **PostgreSQL 16 asli via
  testcontainers**, menjalankan seluruh migrasi goose, lalu menguji alur
  end-to-end (auth, CSRF, ledger, laporan, CSV, mailsync, job lifecycle).
  Otomatis di-*skip* bila Docker tidak tersedia.

---

## Keamanan & Privasi

- Scope Gmail **read-only** — Spendly tidak pernah menulis/mengubah/menghapus email.
- Refresh token Gmail disimpan **terenkripsi AES-256-GCM**; access token di memori.
- Sesi cookie `HttpOnly; SameSite=Lax` (+ `Secure` di produksi) + token CSRF.
- Redaksi nomor kartu/rekening/telepon/OTP sebelum teks dikirim ke AI.
- Body email mentah **tidak disimpan**; yang disimpan hanya header, `content_hash`,
  hasil ekstraksi, dan transaksi.
- Rate limit API + body limit; log tidak memuat isi email atau token.
- Putus Gmail = revoke token di Google; hapus akun = hapus seluruh data (cascade).

---

## Deployment

### Docker Compose

```bash
cp .env.example .env   # isi kredensial produksi
docker compose up -d --build
```

`compose.yml` menjalankan PostgreSQL + API. Dockerfile multi-stage membangun
frontend (Bun) → binary Go (embed SPA) → image **distroless** non-root.

### Build binary

```bash
make build        # bin/api dengan versi/build time/git commit
./bin/api
```

Set `APP_ENV=production` agar validasi konfigurasi ketat dan log JSON aktif.

---

## Roadmap

- [x] Fondasi: login Google, ledger manual, dashboard, SPA embedded.
- [x] Gmail connect: OAuth tahap-2, pemilihan sender, backfill, clean, `raw_emails` idempoten.
- [x] AI extraction: schema + parsing Go, review queue, golden set.
- [x] Sync matang: job async (pause/resume/cancel, SSE, persisten), dedup, daftar Diabaikan.
- [ ] Fase 2: budget per kategori, ringkasan AI, deteksi langganan/anomali, multi-mailbox.

---

## Lisensi

MIT — lihat [LICENSE](LICENSE).
