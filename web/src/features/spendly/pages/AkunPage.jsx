import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Mail, Trash2, LogOut, RefreshCw, Plus, ShieldCheck, Check,
  Pause, Play, Square,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Panel, SectionTitle, Chip } from '@/features/spendly/components/primitives';
import AddSenderDrawer from '@/features/spendly/components/AddSenderDrawer';
import ConfirmDialog from '@/features/spendly/components/ConfirmDialog';
import { useAuthStore } from '@/features/auth/store';
import client from '@/lib/client';
import {
  getGmailConnections, disconnectGmail, getSenders, putSenders, deleteSenderRegistry,
  getSyncStatus, startGmailSync, getSyncJob, getActiveSyncJob, pauseSyncJob, resumeSyncJob, cancelSyncJob, syncEventsUrl, updateGmailSettings,
} from '@/features/spendly/api';

// Preset jendela scan. "Bulan ini" dihitung dari tanggal 1 bulan berjalan.
const WINDOWS = [
  { key: '1d', label: '1 hari', days: 1 },
  { key: '7d', label: '7 hari', days: 7 },
  { key: 'month', label: 'Bulan ini', days: null },
  { key: '30d', label: '30 hari', days: 30 },
  { key: '90d', label: '90 hari', days: 90 },
  { key: 'custom', label: 'Rentang', days: null },
];

function windowDays(key) {
  if (key === 'month') return new Date().getDate();
  if (key === 'custom') return null;
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
  const [loading, setLoading] = useState(true);
  const [senderOpen, setSenderOpen] = useState(false);
  const [pendingSender, setPendingSender] = useState(null);
  const [scan, setScan] = useState({ window: '30d', limit: 100, from: '', to: '' });
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
        if (st?.scan_window) setScan({ window: st.scan_window, limit: st.scan_limit || 100, from: st.scan_from || '', to: st.scan_to || '' });
        // Pulihkan indikator progres bila ada sync yang masih berjalan.
        await restoreActiveJob(c[0].id);
      } else {
        // Tidak ada koneksi — bersihkan state terkait Gmail.
        setSenders([]);
        setStatus(null);
        setJob(null);
      }
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

  async function onDeleteSender() {
    const s = pendingSender;
    setPendingSender(null);
    if (!s) return;
    setBusy(`del:${s.id}`);
    try {
      await deleteSenderRegistry(s.id);
      toast.success('Pengirim dihapus');
      load();
    } catch (e) { toast.error(e?.response?.data?.message || 'Gagal menghapus pengirim'); }
    finally { setBusy(''); }
  }

  async function saveScan(next) {
    setScan(next);
    try {
      await updateGmailSettings(connId, {
        scan_window: next.window,
        scan_limit: Number(next.limit) || 100,
        scan_from: next.from || '',
        scan_to: next.to || '',
      });
      toast.success('Pengaturan scan disimpan');
    } catch (e) { toast.error(e?.response?.data?.message || 'Gagal menyimpan'); }
  }

  function applyCustomRange() {
    if (!scan.from || !scan.to) { toast.error('Isi tanggal dari dan sampai'); return; }
    if (scan.from > scan.to) { toast.error('Tanggal akhir harus setelah tanggal awal'); return; }
    saveScan({ ...scan, window: 'custom' });
  }

  function commitLimit() {
    const v = Math.min(1000, Math.max(1, Number(scan.limit) || 100));
    saveScan({ ...scan, limit: v });
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
      const maxEmails = Number(scan.limit) || 0;
      const { job_id } = await startGmailSync({
        connection_id: connId,
        max_emails: maxEmails,
        ...(force && scan.window !== 'custom' ? { backfill_days: windowDays(scan.window) } : {}),
      });
      saveStoredJob(connId, job_id);
      setJob({ id: job_id, progress: { status: 'running', message: 'menyiapkan', processed: 0, total: maxEmails } });
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
                      <Chip
                        key={w.key}
                        active={scan.window === w.key}
                        onClick={() => (w.key === 'custom' ? setScan({ ...scan, window: 'custom' }) : saveScan({ ...scan, window: w.key }))}
                      >
                        {w.label}
                      </Chip>
                    ))}
                  </div>
                </div>

                {scan.window === 'custom' && (
                  <div className="space-y-2">
                    <p className="text-[11px] font-medium text-lichen">Rentang tanggal</p>
                    <div className="flex items-center gap-2">
                      <Input type="date" value={scan.from} onValueChange={(v) => setScan({ ...scan, from: v })} aria-label="Dari tanggal" className="h-10 flex-1" />
                      <span className="text-xs text-lichen">s/d</span>
                      <Input type="date" value={scan.to} onValueChange={(v) => setScan({ ...scan, to: v })} aria-label="Sampai tanggal" className="h-10 flex-1" />
                    </div>
                    <button
                      type="button"
                      onClick={applyCustomRange}
                      className="h-10 w-full rounded-full border border-forest-ink bg-forest-ink text-xs font-medium text-white cursor-pointer"
                    >
                      Terapkan rentang
                    </button>
                  </div>
                )}

                <div>
                  <p className="mb-1.5 text-[11px] font-medium text-lichen">Maksimal email per sinkronisasi</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {[25, 50, 100, 200].map((l) => (
                      <Chip key={l} active={Number(scan.limit) === l} onClick={() => saveScan({ ...scan, limit: l })}>{l}</Chip>
                    ))}
                    <Input
                      value={String(scan.limit ?? '')}
                      onValueChange={(v) => setScan({ ...scan, limit: v.replace(/[^0-9]/g, '') })}
                      onBlur={commitLimit}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                      inputMode="numeric"
                      aria-label="Maksimal email"
                      className="tnum h-9 w-20 text-center font-mono text-xs"
                    />
                    <span className="text-[11px] text-lichen">email (1–1000)</span>
                  </div>
                </div>
                <p className="text-[11px] leading-relaxed text-lichen">
                  {scan.window === 'custom'
                    ? `Scan email dalam rentang ${scan.from || '…'} s/d ${scan.to || '…'}, maksimal ${scan.limit || 100} email.`
                    : `Hanya email dari pengirim terpilih, ${windowDays(scan.window)} hari terakhir, maksimal ${scan.limit || 100} email per sinkronisasi.`}
                  {' '}Sync hanya jalan saat kamu klik.
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
                onClick={() => setSenderOpen(true)}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm border border-border bg-card text-xs font-medium text-lichen transition-colors hover:bg-mint cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" /> Tambah pengirim
              </button>

              {senders.length > 0 && (
                <div className="pt-1">
                  <p className="mb-2 flex items-center gap-1.5 font-mono text-[11px] font-medium tracking-wide text-saffron uppercase">
                    <ShieldCheck className="h-3.5 w-3.5" /> Email yang dibaca
                  </p>
                  <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                    {senders.map((s) => (
                      <div key={s.domain} className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => toggleSender(s.domain, s.allowed)}
                          className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-2.5 py-2.5 text-left transition-colors hover:bg-mint cursor-pointer"
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
                        {s.can_delete && (
                          <button
                            type="button"
                            onClick={() => setPendingSender(s)}
                            disabled={busy === `del:${s.id}`}
                            aria-label="Hapus pengirim"
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-lichen transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
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

      <AddSenderDrawer open={senderOpen} onOpenChange={setSenderOpen} onAdded={load} />

      <ConfirmDialog
        open={!!pendingSender}
        onOpenChange={(open) => { if (!open) setPendingSender(null); }}
        title="Hapus pengirim ini?"
        description={pendingSender ? `${pendingSender.label || pendingSender.domain} akan dihapus dari daftar.` : ''}
        confirmLabel="Hapus"
        onConfirm={onDeleteSender}
      />
    </div>
  );
}
