import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Mail, Trash2, LogOut, RefreshCw, Repeat, Plus, ShieldCheck, Check,
  Pause, Play, Square,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency } from '@/lib/utils';
import { Panel, SectionTitle, Chip } from '@/features/spendly/components/primitives';
import { useAuthStore } from '@/features/auth/store';
import client from '@/lib/client';
import {
  getGmailConnections, disconnectGmail, getSenders, putSenders, discoverSenders,
  getSyncStatus, getRecurring, createRecurring, deleteRecurring, bookRecurring,
  startGmailSync, getSyncJob, getActiveSyncJob, pauseSyncJob, resumeSyncJob, cancelSyncJob, syncEventsUrl, updateGmailSettings,
} from '@/features/spendly/api';

// Preset jendela scan. "Bulan ini" dihitung dari tanggal 1 bulan berjalan.
const WINDOWS = [
  { key: '1d', label: '1 hari', days: 1 },
  { key: '7d', label: '7 hari', days: 7 },
  { key: 'month', label: 'Bulan ini', days: null },
  { key: '30d', label: '30 hari', days: 30 },
  { key: '90d', label: '90 hari', days: 90 },
];

function windowDays(key) {
  if (key === 'month') return new Date().getDate();
  return WINDOWS.find((w) => w.key === key)?.days || 30;
}

const ACTIVE_STATUSES = ['running', 'paused', 'canceling'];
const TERMINAL_STATUSES = ['done', 'error', 'canceled'];

// Job aktif disimpan agar indikator pulih saat halaman dibuka ulang.
const JOB_KEY = 'spendly:sync-job';
function saveStoredJob(connId, jobId) {
  try {
    localStorage.setItem(JOB_KEY, JSON.stringify({ connId, jobId }));
  } catch {
    /* penyimpanan lokal tidak tersedia — indikator tidak pulih */
  }
}
function readStoredJob() {
  try {
    const raw = localStorage.getItem(JOB_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function clearStoredJob() {
  try {
    localStorage.removeItem(JOB_KEY);
  } catch {
    /* abaikan */
  }
}

export default function AkunPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const [busy, setBusy] = useState('');
  const [conns, setConns] = useState([]);
  const [senders, setSenders] = useState([]);
  const [status, setStatus] = useState(null);
  const [recurring, setRecurring] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newSub, setNewSub] = useState({ merchant: '', amount: '' });
  const [scan, setScan] = useState({ window: '30d', limit: 100 });
  const [job, setJob] = useState(null); // { id, progress }
  const esRef = useRef(null);
  const mountedRef = useRef(true);

  const connId = conns[0]?.id || '';

  async function load() {
    setLoading(true);
    try {
      const c = await getGmailConnections().catch(() => []);
      setConns(c);
      if (c[0]) {
        const [s, st] = await Promise.all([
          getSenders(c[0].id).catch(() => null),
          getSyncStatus(c[0].id).catch(() => null),
        ]);
        setSenders(s?.items || []);
        setStatus(st);
        if (st?.scan_window) setScan({ window: st.scan_window, limit: st.scan_limit || 100 });
        // Pulihkan indikator progres bila ada sync yang masih berjalan.
        await restoreActiveJob(c[0].id);
      } else {
        // Tidak ada koneksi — bersihkan state terkait Gmail.
        setSenders([]);
        setStatus(null);
        setJob(null);
      }
      setRecurring(await getRecurring().catch(() => []));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => {
      mountedRef.current = false;
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function connectGmail() {
    window.location.href = '/api/v1/gmail/connect';
  }

  async function onDisconnect(id) {
    setBusy('dc');
    try {
      await disconnectGmail(id);
      toast.success('Gmail diputus');
      // Reset state lokal lebih dulu agar UI tidak menampilkan koneksi lama
      // saat menunggu refetch dari server.
      setConns([]);
      setStatus(null);
      setSenders([]);
      setJob(null);
      clearStoredJob();
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
      // Refetch data terbaru dari server (await agar tidak ada race condition
      // antara optimistic update di atas dengan hasil load()).
      await load();
    } catch (e) { toast.error(e?.response?.data?.message || 'Gagal memutus Gmail'); }
    finally { setBusy(''); }
  }

  async function toggleSender(domain, allowed) {
    const next = senders.map((s) => (s.domain === domain ? { ...s, allowed: !allowed } : s));
    setSenders(next);
    try {
      await putSenders(connId, next.filter((s) => s.allowed).map((s) => s.domain));
    } catch {
      toast.error('Gagal menyimpan pilihan');
      load();
    }
  }

  async function onDiscover() {
    setBusy('disc');
    try {
      const items = await discoverSenders(connId);
      const tx = items.filter((i) => i.suggested);
      toast.success(`Ditemukan ${items.length} pengirim, ${tx.length} terlihat transaksional`);
      if (tx.length > 0) {
        await putSenders(connId, [...new Set([...senders.filter((s) => s.allowed).map((s) => s.domain), ...tx.map((t) => t.domain)])]);
        load();
      }
    } catch (e) { toast.error(e?.response?.data?.message || 'Gagal menemukan pengirim'); }
    finally { setBusy(''); }
  }

  async function saveScan(next) {
    setScan(next);
    try {
      await updateGmailSettings(connId, { scan_window: next.window, scan_limit: next.limit });
      toast.success('Pengaturan scan disimpan');
    } catch (e) { toast.error(e?.response?.data?.message || 'Gagal menyimpan'); }
  }

  function subscribe(jobId) {
    if (esRef.current) esRef.current.close();
    const es = new EventSource(syncEventsUrl(jobId));
    esRef.current = es;
    es.onmessage = (e) => {
      let p;
      try { p = JSON.parse(e.data); } catch { return; }
      if (!mountedRef.current) { es.close(); return; }
      setJob({ id: jobId, progress: p });
      if (TERMINAL_STATUSES.includes(p.status)) {
        es.close();
        esRef.current = null;
        clearStoredJob();
        if (!mountedRef.current) return;
        if (p.status === 'done') toast.success(`Selesai: ${p.new} baru, ${p.gated} diabaikan, ${p.extracted} diekstrak`);
        else if (p.status === 'error') toast.error(p.message || 'Sinkronisasi gagal');
        else toast('Sinkronisasi dibatalkan');
        setTimeout(() => { if (mountedRef.current) setJob(null); }, 2500);
        load();
      }
    };
    // Hentikan reconnect bila job sudah terminal (mis. server balas 404 / job selesai).
    es.onerror = () => {
      if (!esRef.current) return; // sudah ditutup secara sengaja
      getSyncJob(jobId)
        .then(({ progress }) => {
          if (!mountedRef.current) { es.close(); esRef.current = null; return; }
          if (progress && TERMINAL_STATUSES.includes(progress.status)) {
            es.close();
            esRef.current = null;
            clearStoredJob();
            setJob((prev) => prev?.id === jobId ? { id: jobId, progress } : prev);
            setTimeout(() => { if (mountedRef.current) setJob(null); }, 2500);
            load();
          }
          // Bila masih running/paused biarkan EventSource reconnect otomatis.
        })
        .catch(() => {
          // Bila 404/network: job tidak dikenal server — bersihkan.
          es.close();
          esRef.current = null;
          clearStoredJob();
          if (mountedRef.current) setJob(null);
        });
    };
  }

  // Pulihkan indikator bila ada job yang masih berjalan (mis. setelah pindah menu).
  async function restoreActiveJob(currentConnId) {
    let jobId = null;
    try {
      const a = await getActiveSyncJob(currentConnId);
      jobId = a?.job_id || null;
    } catch { /* abaikan, coba penyimpanan lokal */ }
    if (!jobId) {
      const stored = readStoredJob();
      if (stored && stored.connId === currentConnId) jobId = stored.jobId;
    }
    if (!jobId) return;
    // Pastikan komponen masih terpasang sebelum melanjutkan.
    if (!mountedRef.current) return;
    try {
      const { progress } = await getSyncJob(jobId);
      if (!mountedRef.current) return;
      if (progress && ACTIVE_STATUSES.includes(progress.status)) {
        saveStoredJob(currentConnId, jobId);
        setJob({ id: jobId, progress });
        subscribe(jobId);
      } else {
        clearStoredJob();
        // Jika sudah terminal tapi job masih tersimpan di localStorage, tampilkan status terakhir sebentar.
        if (progress && TERMINAL_STATUSES.includes(progress.status)) {
          setJob({ id: jobId, progress });
          setTimeout(() => { if (mountedRef.current) setJob(null); }, 3000);
        }
      }
    } catch {
      clearStoredJob();
    }
  }

  async function runSync(force) {
    try {
      const { job_id } = await startGmailSync({
        connection_id: connId,
        max_emails: scan.limit,
        ...(force ? { backfill_days: windowDays(scan.window) } : {}),
      });
      saveStoredJob(connId, job_id);
      setJob({ id: job_id, progress: { status: 'running', message: 'menyiapkan', processed: 0, total: scan.limit } });
      subscribe(job_id);
    } catch (e) { toast.error(e?.response?.data?.message || 'Gagal memulai sinkronisasi'); }
  }

  async function control(action) {
    if (!job?.id) return;
    try {
      if (action === 'pause') await pauseSyncJob(job.id);
      else if (action === 'resume') await resumeSyncJob(job.id);
      else if (action === 'cancel') await cancelSyncJob(job.id);
    } catch (e) { toast.error(e?.response?.data?.message || 'Gagal'); }
  }

  async function deleteAccount() {
    if (!confirm('Hapus akun + seluruh data? Tindakan ini permanen.')) return;
    setBusy('del');
    try {
      await client.delete('/users/me');
      await logout();
      navigate('/login', { replace: true });
    } catch (e) { toast.error(e?.response?.data?.message || 'Gagal hapus akun'); }
    finally { setBusy(''); }
  }

  async function onLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  async function addRecurring(e) {
    e.preventDefault();
    const amount = Number(String(newSub.amount).replace(/[^0-9]/g, ''));
    if (!newSub.merchant || !amount) {
      toast.error('Isi nama dan nominal');
      return;
    }
    try {
      await createRecurring({ merchant: newSub.merchant, amount, category: 'Tagihan', cadence: 'monthly' });
      setNewSub({ merchant: '', amount: '' });
      toast.success('Langganan ditambahkan');
      load();
    } catch { toast.error('Gagal menambah'); }
  }

  const initial = (user?.name || user?.email || 'S')[0].toUpperCase();
  const p = job?.progress;
  const jobActive = p && ACTIVE_STATUSES.includes(p.status);
  // Persentase progres: bila total belum diketahui (=0), tampilkan -1 sebagai sinyal indeterminate.
  const pct = p?.total > 0 ? Math.min(100, Math.round((p.processed / p.total) * 100)) : -1;
  const isIndeterminate = pct === -1 && jobActive;

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-[22px] leading-tight font-medium tracking-tight text-forest-ink">Akun</h1>

      {/* Profil */}
      <Panel className="flex items-center gap-3.5 p-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-full border border-forest-ink bg-forest-ink font-heading text-lg font-medium text-white">
          {initial}
        </span>
        <div className="min-w-0">
          <p className="truncate font-heading text-sm font-medium text-forest-ink">{user?.name || 'Pengguna Spendly'}</p>
          <p className="truncate font-mono text-[11px] text-lichen">{user?.email || ''}</p>
        </div>
      </Panel>

      {/* Gmail */}
      <div>
        <SectionTitle>Gmail</SectionTitle>
        <Panel className="p-4">
          {loading ? (
            <Skeleton className="h-10 w-full rounded-sm" />
          ) : conns.length === 0 ? (
            <div className="space-y-3">
              <p className="text-xs leading-relaxed text-lichen">
                Hubungkan Gmail agar struk dan notifikasi transaksi terbaca otomatis. Hanya pengirim yang kamu izinkan yang dibaca.
              </p>
              <button
                type="button"
                onClick={connectGmail}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-forest-ink bg-forest-ink text-sm font-medium text-white cursor-pointer"
              >
                <Mail className="h-4 w-4" /> Hubungkan Gmail
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {conns.map((c) => (
                <div key={c.id} className="rounded-md border border-border bg-mint/50 px-3.5 py-3">
                  <div className="flex items-center gap-3">
                    <Mail className="h-4 w-4 shrink-0 text-lichen" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-forest-ink">{c.google_email || 'Gmail terhubung'}</span>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium ${
                      c.status === 'active' ? 'border-deep-forest/30 bg-sage text-deep-forest' : 'border-saffron/40 bg-butter text-saffron'
                    }`}>
                      {c.status}
                    </span>
                    <button type="button" onClick={() => onDisconnect(c.id)} disabled={busy === 'dc'} className="shrink-0 text-xs font-medium text-destructive cursor-pointer">
                      Putus
                    </button>
                  </div>
                  {c.status === 'needs_reauth' && (
                    <div className="mt-2.5 space-y-2 border-t border-border pt-2.5">
                      <p className="text-[11px] leading-relaxed text-saffron">
                        Akses Gmail terputus. Hubungkan ulang agar sinkronisasi bisa jalan lagi.
                      </p>
                      <button
                        type="button"
                        onClick={connectGmail}
                        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full border border-forest-ink bg-forest-ink text-xs font-medium text-white cursor-pointer"
                      >
                        <RefreshCw className="h-3.5 w-3.5" /> Hubungkan ulang Gmail
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {status && (
                <p className="font-mono text-[11px] text-lichen">
                  sync terakhir: {status.last_synced_at ? new Date(status.last_synced_at).toLocaleString('id-ID') : 'belum pernah'}
                  {status.total_scanned ? ` · ${status.total_scanned} email dipindai` : ''}
                </p>
              )}

              {/* Pengaturan scan */}
              <div className="space-y-3 rounded-md border border-border p-3">
                <p className="eyebrow">Pengaturan scan</p>
                <div>
                  <p className="mb-1.5 text-[11px] font-medium text-lichen">Jendela email</p>
                  <div className="flex flex-wrap gap-2">
                    {WINDOWS.map((w) => (
                      <Chip key={w.key} active={scan.window === w.key} onClick={() => saveScan({ ...scan, window: w.key })}>
                        {w.label}
                      </Chip>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-[11px] font-medium text-lichen">Maksimal email per sinkronisasi</p>
                  <div className="flex flex-wrap gap-2">
                    {[25, 50, 100, 200].map((l) => (
                      <Chip key={l} active={scan.limit === l} onClick={() => saveScan({ ...scan, limit: l })}>{l} email</Chip>
                    ))}
                  </div>
                </div>
                <p className="text-[11px] leading-relaxed text-lichen">
                  Hanya email dari pengirim terpilih, {windowDays(scan.window)} hari terakhir, maksimal {scan.limit} email per sinkronisasi. Sync hanya jalan saat kamu klik.
                </p>
              </div>

              {/* Progres job */}
              {p && (
                <div className="space-y-2 rounded-md border border-border bg-mint/40 p-3">
                  <div className="flex items-center justify-between">
                    <p className="eyebrow">{p.status === 'paused' ? 'Dijeda' : p.status === 'canceling' ? 'Menghentikan…' : p.status === 'done' ? 'Selesai' : p.status === 'error' ? 'Gagal' : 'Berjalan'}</p>
                    <span className="tnum font-mono text-[11px] text-lichen">{p.processed}/{p.total || '?'}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                    {isIndeterminate ? (
                      <div className="h-full w-1/3 rounded-full bg-network animate-pulse" />
                    ) : (
                      <div
                        className={`h-full rounded-full ${p.status === 'error' ? 'bg-destructive' : 'bg-network'} transition-[width] duration-300`}
                        style={{ width: `${Math.max(2, pct)}%` }}
                      />
                    )}
                  </div>
                  <p className="truncate font-mono text-[11px] text-lichen">{p.current || p.message}</p>
                  <div className="flex gap-2">
                    {p.status === 'running' && (
                      <button type="button" onClick={() => control('pause')} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full border border-forest-ink bg-transparent text-xs font-medium text-forest-ink cursor-pointer">
                        <Pause className="h-3.5 w-3.5" /> Jeda
                      </button>
                    )}
                    {p.status === 'paused' && (
                      <button type="button" onClick={() => control('resume')} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full border border-forest-ink bg-forest-ink text-xs font-medium text-white cursor-pointer">
                        <Play className="h-3.5 w-3.5" /> Lanjut
                      </button>
                    )}
                    {jobActive && (
                      <button type="button" onClick={() => control('cancel')} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full border border-destructive/50 text-xs font-medium text-destructive cursor-pointer">
                        <Square className="h-3.5 w-3.5" /> Hentikan
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => runSync(false)}
                  disabled={!!jobActive}
                  className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-full border border-forest-ink bg-forest-ink text-xs font-medium text-white transition-colors hover:bg-forest-ink/90 disabled:opacity-60 cursor-pointer"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Sync sekarang
                </button>
                <button
                  type="button"
                  onClick={() => runSync(true)}
                  disabled={!!jobActive}
                  className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-full border border-forest-ink bg-transparent text-xs font-medium text-forest-ink transition-colors hover:bg-forest-ink/5 disabled:opacity-60 cursor-pointer"
                >
                  Scan ulang
                </button>
              </div>

              <button
                type="button"
                onClick={onDiscover}
                disabled={busy === 'disc' || !!jobActive}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm border border-border bg-card text-xs font-medium text-lichen transition-colors hover:bg-mint disabled:opacity-60 cursor-pointer"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${busy === 'disc' ? 'animate-spin' : ''}`} /> Temukan pengirim
              </button>

              {senders.length > 0 && (
                <div className="pt-1">
                  <p className="mb-2 flex items-center gap-1.5 font-mono text-[11px] font-medium tracking-wide text-saffron uppercase">
                    <ShieldCheck className="h-3.5 w-3.5" /> Email yang dibaca
                  </p>
                  <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                    {senders.map((s) => (
                      <button
                        key={s.domain}
                        type="button"
                        onClick={() => toggleSender(s.domain, s.allowed)}
                        className="flex w-full items-center gap-3 rounded-md px-2.5 py-2.5 text-left transition-colors hover:bg-mint cursor-pointer"
                      >
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border ${
                          s.allowed ? 'border-forest-ink bg-forest-ink text-white' : 'border-border text-transparent'
                        }`}>
                          <Check className="h-3.5 w-3.5" strokeWidth={3} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium text-forest-ink">{s.label || s.domain}</span>
                          <span className="block truncate font-mono text-[11px] text-lichen">{s.domain}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Panel>
      </div>

      {/* Langganan */}
      <div>
        <SectionTitle>Langganan & cicilan</SectionTitle>
        <Panel className="p-4">
          {recurring.length > 0 && (
            <div className="mb-3 space-y-2">
              {recurring.map((r) => (
                <div key={r.id} className="flex items-center gap-3 rounded-md border border-border bg-mint/50 px-3.5 py-3">
                  <Repeat className="h-4 w-4 shrink-0 text-lichen" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-forest-ink">{r.merchant}</p>
                    <p className="tnum font-mono text-[11px] text-lichen">{formatCurrency(r.amount)} · bulanan</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => bookRecurring(r.id).then(() => { toast.success('Tercatat'); window.dispatchEvent(new CustomEvent('spendly:refresh')); })}
                    className="shrink-0 text-xs font-medium text-deep-forest cursor-pointer"
                  >
                    Catat
                  </button>
                  <button type="button" onClick={() => deleteRecurring(r.id).then(load)} className="shrink-0 text-xs text-lichen cursor-pointer">
                    Hapus
                  </button>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={addRecurring} className="flex gap-2">
            <Input value={newSub.merchant} onValueChange={(v) => setNewSub({ ...newSub, merchant: v })} placeholder="Netflix, Spotify…" aria-label="Nama langganan" className="h-10 flex-1" />
            <Input value={newSub.amount} onValueChange={(v) => setNewSub({ ...newSub, amount: v })} inputMode="numeric" placeholder="Rp" aria-label="Nominal" className="tnum h-10 w-24 font-mono" />
            <button type="submit" aria-label="Tambah" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-forest-ink bg-forest-ink text-white cursor-pointer">
              <Plus className="h-4 w-4" />
            </button>
          </form>
        </Panel>
      </div>

      {/* Akun */}
      <div>
        <SectionTitle>Akun</SectionTitle>
        <Panel className="divide-y divide-border">
          <button
            type="button"
            onClick={onLogout}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-medium text-forest-ink transition-colors hover:bg-mint cursor-pointer"
          >
            <LogOut className="h-4 w-4 text-lichen" /> Keluar
          </button>
          <button
            type="button"
            onClick={deleteAccount}
            disabled={busy === 'del'}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-medium text-destructive transition-colors hover:bg-destructive/5 disabled:opacity-50 cursor-pointer"
          >
            <Trash2 className="h-4 w-4" /> {busy === 'del' ? 'Menghapus…' : 'Hapus akun & data'}
          </button>
        </Panel>
      </div>

      <p className="px-4 text-center font-mono text-[11px] leading-relaxed text-lichen">
        Spendly hanya membaca email dari pengirim yang kamu izinkan. Isi email tidak disimpan.
      </p>
    </div>
  );
}
