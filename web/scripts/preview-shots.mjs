// Generator preview README: screenshot halaman → bingkai iPhone → PNG.
//
// Cara pakai (DB + API terpisah agar data lokal tidak kotor):
//   docker exec spendly-postgres-1 psql -U spendly -c "CREATE DATABASE spendly_preview"
//   GOOGLE_CLIENT_ID= GOOGLE_CLIENT_SECRET= \
//     DATABASE_URL=postgres://spendly:spendly@localhost:5432/spendly_preview?sslmode=disable \
//     APP_PORT=8901 go run ./cmd/api   # dari root repo
//   cd web && bun run preview:shots [--base http://localhost:8901]
//
// Hasil: docs/preview/{beranda,transaksi,laporan,akun}.png (transparan, siap README).
// Data demo di-seed otomatis bila transaksi masih kosong (idempoten).
import { mkdtemp, rm, writeFile, readFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] ?? '']);
    return acc;
  }, []),
);
const BASE = (args.base || process.env.PREVIEW_BASE || 'http://localhost:8901').replace(/\/$/, '');
const OUT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../docs/preview');

const VW = 393; // iPhone 14 Pro CSS px
const VH = 852;
const STRIP = 54; // status bar khusus frame (di luar screenshot)
const SHOT_H = VH - STRIP; // viewport shot agar total pas rasio iPhone

// Makanan realistic bulan berjalan (amount = rupiah, bukan sen).
function seedData() {
  const now = new Date();
  const d = (day) =>
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(Math.min(day, 28)).padStart(2, '0')}`;
  return [
    { amount: 58000, category: 'Makanan', merchant: 'GoFood', note: 'Ayam geprek', occurred_at: d(2) },
    { amount: 25000, category: 'Makanan', merchant: 'Kopi Kenangan', note: 'Kopi susu', occurred_at: d(4) },
    { amount: 8000, category: 'Transport', merchant: 'KRL', note: 'Commuter', occurred_at: d(5) },
    { amount: 150000, category: 'Transport', merchant: 'Pertamina', note: 'Bensin', occurred_at: d(9) },
    { amount: 73500, category: 'Belanja', merchant: 'Indomaret', note: 'Belanja mingguan', occurred_at: d(12) },
    { amount: 312000, category: 'Tagihan', merchant: 'PLN', note: 'Listrik', occurred_at: d(15) },
    { amount: 65000, category: 'Hiburan', merchant: 'Netflix', note: 'Langganan', occurred_at: d(18) },
    { amount: 45000, category: 'Kesehatan', merchant: 'Apotek', note: 'Vitamin', occurred_at: d(21) },
  ];
}

// Bingkai iPhone (titanium + Dynamic Island + status bar + tombol samping).
function framePage(imgURL) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;background:transparent;font-family:-apple-system,'SF Pro Text',Inter,sans-serif}
.stage{width:520px;height:1000px;position:relative}
.phone{position:absolute;left:49px;top:40px;width:421px;padding:14px;background:linear-gradient(145deg,#4a4a4e,#17171a 60%,#333336);border-radius:66px;box-shadow:0 40px 80px -20px rgba(0,0,0,.45),0 12px 24px rgba(0,0,0,.25)}
.screen{position:relative;border-radius:52px;overflow:hidden;background:#f7f6f2;line-height:0}
.screen img{width:393px;height:798px;object-fit:cover;object-position:top;display:block}
.strip{height:54px;background:#f7f6f2;display:flex;align-items:center;justify-content:space-between;padding:14px 36px 0;color:#001f1f;line-height:1}
.strip .time{font-size:15px;font-weight:600;letter-spacing:-.01em}
.strip .sic{display:flex;align-items:center;gap:6px}
.island{position:absolute;top:22px;left:50%;transform:translateX(-50%);width:112px;height:32px;background:#000;border-radius:20px;line-height:0}
.btn{position:absolute;background:linear-gradient(90deg,#2c2c2f,#0f0f11);border-radius:3px}
.btn-mute{left:-2.5px;top:150px;width:4px;height:30px}
.btn-vup{left:-2.5px;top:200px;width:4px;height:58px}
.btn-vdn{left:-2.5px;top:264px;width:4px;height:58px}
.btn-pwr{right:-2.5px;top:200px;width:4px;height:88px}
</style></head><body><div class="stage"><div class="phone">
<div class="btn btn-mute"></div><div class="btn btn-vup"></div><div class="btn btn-vdn"></div><div class="btn btn-pwr"></div>
<div class="screen"><div class="strip"><span class="time">9:41</span><span class="sic">
<svg width="18" height="12" viewBox="0 0 18 12" fill="#001f1f"><rect x="0" y="7" width="3" height="5" rx="1"/><rect x="5" y="5" width="3" height="7" rx="1"/><rect x="10" y="2.5" width="3" height="9.5" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>
<svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="#001f1f" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="10" r="1.1" fill="#001f1f" stroke="none"/><path d="M5.7 8.1a3.3 3.3 0 0 1 4.6 0"/><path d="M3.8 6.2a6 6 0 0 1 8.4 0"/><path d="M1.9 4.3a8.6 8.6 0 0 1 12.2 0"/></svg>
<svg width="25" height="12" viewBox="0 0 25 12" fill="none"><rect x="0.5" y="0.5" width="21" height="11" rx="3.5" stroke="#001f1f" opacity=".5"/><rect x="2" y="2" width="15" height="8" rx="2" fill="#001f1f"/><path d="M23.5 4v4a2 2 0 0 0 0-4z" fill="#001f1f" opacity=".5"/></svg>
</span></div><img src="${imgURL}"><div class="island"></div></div></div></div></body></html>`;
}

async function launch() {
  try {
    return await chromium.launch({ channel: 'chrome' });
  } catch {
    for (const exe of [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/usr/bin/google-chrome',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    ]) {
      try {
        return await chromium.launch({ executablePath: exe });
      } catch { /* coba berikutnya */ }
    }
    throw new Error('Chrome tidak ditemukan (butuh Google Chrome / chromium playwright)');
  }
}

const browser = await launch();
const ctx = await browser.newContext({
  viewport: { width: VW, height: SHOT_H },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

// Login dev (butuh API jalan dengan GOOGLE_CLIENT_ID kosong).
const login = await ctx.request.post(`${BASE}/api/v1/auth/login`, { data: { username: 'dev' } });
if (!login.ok()) throw new Error(`login dev gagal (${login.status()}) — pastikan API jalan tanpa GOOGLE_CLIENT_ID`);
const csrf = (await ctx.cookies()).find((c) => c.name === 'csrf_token')?.value || '';
const headers = csrf ? { 'X-CSRF-Token': csrf } : {};

// Seed demo bila kosong.
const list = await (await ctx.request.get(`${BASE}/api/v1/transactions?limit=1`)).json();
if ((list?.meta?.total ?? 0) === 0) {
  for (const t of seedData()) {
    const r = await ctx.request.post(`${BASE}/api/v1/transactions`, { data: t, headers });
    if (!r.ok()) throw new Error(`seed gagal: ${await r.text()}`);
  }
  console.log('seed: 8 transaksi demo');

  try {
    const pgContainer = process.env.PREVIEW_PG || 'spendly-postgres-1';
    const sql = `
      DO $$
      DECLARE
        v_uid uuid;
        v_conn_id uuid;
      BEGIN
        SELECT id INTO v_uid FROM users WHERE google_sub = 'dev' LIMIT 1;
        IF v_uid IS NOT NULL THEN
          INSERT INTO gmail_connections (id, user_id, google_email, enc_refresh_token, status)
          VALUES ('11111111-1111-1111-1111-111111111111', v_uid, 'dev@spendly.local', 'enc_dummy', 'active')
          ON CONFLICT DO NOTHING;

          v_conn_id := '11111111-1111-1111-1111-111111111111';

          INSERT INTO senders (connection_id, email_domain, name, is_active)
          VALUES 
            (v_conn_id, 'bca.co.id', 'Bank BCA', true),
            (v_conn_id, 'gofood.co.id', 'GoFood', true),
            (v_conn_id, 'tokopedia.com', 'Tokopedia', true)
          ON CONFLICT DO NOTHING;

          INSERT INTO raw_emails (id, connection_id, gmail_message_id, content_hash, status, subject, sender_domain, received_at)
          VALUES ('22222222-2222-2222-2222-222222222222', v_conn_id, 'msg-review-1', 'hash-rev-1', 'parsed', 'Struk Pembayaran BCA Mobile', 'bca.co.id', NOW() - INTERVAL '1 day')
          ON CONFLICT DO NOTHING;

          INSERT INTO transactions (user_id, amount, currency, category, merchant, note, occurred_at, source, raw_email_id, status, confidence)
          VALUES (v_uid, 125000, 'IDR', 'Tagihan', 'BCA Mobile', 'Tagihan Kartu Kredit', NOW() - INTERVAL '1 day', 'email', '22222222-2222-2222-2222-222222222222', 'needs_review', 0.72)
          ON CONFLICT DO NOTHING;

          INSERT INTO raw_emails (id, connection_id, gmail_message_id, content_hash, status, subject, sender_domain, ignore_reason, received_at)
          VALUES ('33333333-3333-3333-3333-333333333333', v_conn_id, 'msg-ignored-1', 'hash-ign-1', 'gated_out', 'Promo Tokopedia Flash Sale', 'tokopedia.com', 'promo', NOW() - INTERVAL '2 days')
          ON CONFLICT DO NOTHING;

          INSERT INTO transactions (user_id, amount, currency, category, merchant, note, occurred_at, source, status)
          VALUES (v_uid, 45000, 'IDR', 'Makanan', 'Starbucks', 'Kopi salah beli', NOW() - INTERVAL '3 days', 'manual', 'deleted')
          ON CONFLICT DO NOTHING;

          INSERT INTO sync_jobs (id, connection_id, user_id, status, mode, scan_window, emails_total, emails_new, emails_gated, emails_extracted, created_at, finished_at)
          VALUES ('44444444-4444-4444-4444-444444444444', v_conn_id, v_uid, 'done', 'backfill', '30d', 150, 42, 12, 30, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour 58 mins')
          ON CONFLICT DO NOTHING;
        END IF;
      END $$;
    `;
    execSync(`docker exec -i ${pgContainer} psql -U spendly -d spendly_preview`, { input: sql, stdio: ['pipe', 'ignore', 'ignore'] });
    console.log('seed: data tambahan (tinjau, diabaikan, sampah, sinkron, riwayat)');
  } catch (e) {
    console.warn('seed SQL ekstra dilewati:', e.message);
  }
} else {
  console.log('seed: dilewati (sudah ada data)');
}

const tmp = await mkdtemp(join(tmpdir(), 'spendly-shots-'));
const shots = [];
const TARGET_SHOTS = [
  ['beranda', '/beranda'],
  ['transaksi-semua', '/transaksi?tab=all'],
  ['transaksi-tinjau', '/transaksi?tab=review'],
  ['transaksi-diabaikan', '/transaksi?tab=ignored'],
  ['transaksi-sampah', '/transaksi?tab=trash'],
  ['laporan-harian', '/laporan?period=daily'],
  ['laporan-bulanan', '/laporan?period=monthly'],
  ['laporan-tahunan', '/laporan?period=yearly'],
  ['akun-profil', '/akun?tab=akun'],
  ['akun-sinkron', '/akun?tab=sinkron'],
  ['akun-riwayat', '/akun?tab=riwayat'],
];

for (const [name, path] of TARGET_SHOTS) {
  const page = await ctx.newPage();
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000); // chart + skeleton selesai animasi
  await page.addStyleTag({ content: '::-webkit-scrollbar{display:none!important}' });
  console.log('page:', name, '→', JSON.stringify(await page.locator('h1').first().textContent().catch(() => null)));
  const file = join(tmp, `${name}.png`);
  await page.screenshot({ path: file });
  await page.close();
  shots.push([name, file]);
  console.log('shot:', name);
}

// Bingkai tiap shot.
const { mkdirSync } = await import('node:fs');
mkdirSync(OUT, { recursive: true });
for (const [name, file] of shots) {
  const dataURL = `data:image/png;base64,${(await readFile(file)).toString('base64')}`;
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 520, height: 1000 });
  await page.goto('about:blank');
  await page.setContent(framePage(dataURL), { waitUntil: 'load' });
  await page.waitForTimeout(300);
  const el = page.locator('.phone');
  await el.screenshot({ path: join(OUT, `${name}.png`), omitBackground: true });
  await page.close();
  console.log('framed:', name);
}

// Aliases untuk backward compatibility
await copyFile(join(OUT, 'transaksi-semua.png'), join(OUT, 'transaksi.png'));
await copyFile(join(OUT, 'laporan-harian.png'), join(OUT, 'laporan.png'));
await copyFile(join(OUT, 'akun-profil.png'), join(OUT, 'akun.png'));

await browser.close();
await rm(tmp, { recursive: true, force: true });
console.log('selesai →', OUT);

