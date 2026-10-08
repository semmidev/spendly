import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Mail, Trash2, LogOut, RefreshCw, Plus, Pause, Play, Square, Moon, Sun, User, SlidersHorizontal, History, ChevronRight, Download, Search,
} from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { getTheme, toggleTheme } from '@/lib/theme';
import { useInstallPrompt } from '@/lib/useInstallPrompt';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Panel, SectionTitle, Segmented, Switch } from '@/features/spendly/components/primitives';
import AddSenderDrawer from '@/features/spendly/components/AddSenderDrawer';
import ConfirmDialog from '@/features/spendly/components/ConfirmDialog';
import { useAuthStore } from '@/features/auth/store';
import client from '@/lib/client';
import {
  getGmailConnections, disconnectGmail, getSenders, putSenders, deleteSenderRegistry,
  getSyncStatus, startGmailSync, getSyncJob, getActiveSyncJob, pauseSyncJob, resumeSyncJob, cancelSyncJob, syncEventsUrl, updateGmailSettings, getSyncHistory,
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

const AKUN_TABS = [
  { id: 'akun', title: 'Akun', icon: User },
  { id: 'sinkron', title: 'Sinkron', icon: SlidersHorizontal },
  { id: 'riwayat', title: 'Riwayat', icon: History },
];

const JOB_STATUS_STYLE = {
  done: 'text-green-600 dark:text-green-400',
  error: 'text-destructive',
  running: 'text-primary',
  paused: 'text-orange-600 dark:text-orange-400',
  canceling: 'text-orange-600 dark:text-orange-400',
  canceled: 'text-muted-foreground',
};

const JOB_STATUS_LABEL = {
  done: 'Selesai', error: 'Gagal', running: 'Berjalan',
  paused: 'Dijeda', canceling: 'Menghentikan…', canceled: 'Dibatalkan',
};

export default function AkunPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const [busy, setBusy] = useState('');
  const [conns, setConns] = useState([]);
  const [senders, setSenders] = useState([]);
  const [senderSearch, setSenderSearch] = useState('');
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [senderOpen, setSenderOpen] = useState(false);
  const [pendingSender, setPendingSender] = useState(null);
  const [pendingDeleteAccount, setPendingDeleteAccount] = useState(false);
  const [dark, setDark] = useState(() => getTheme() === 'dark');
  const [searchParams] = useSearchParams();
  const [akunTab, setAkunTab] = useState(() => {
    const t = searchParams.get('tab');
    return AKUN_TABS.some((x) => x.id === t) ? t : 'akun';
  });
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const { canInstall, install } = useInstallPrompt();
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
      const { job_id } = await startGmailSync({ connection_id: connId, max_emails: maxEmails, force });
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

  async function loadHistory() {
    if (!connId) { setHistory([]); return; }
    setHistoryLoading(true);
    try {
      setHistory(await getSyncHistory(connId));
    } catch { setHistory([]); }
    finally { setHistoryLoading(false); }
  }

  useEffect(() => {
    if (akunTab === 'riwayat') loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [akunTab, connId]);

  async function deleteAccount() {
    setPendingDeleteAccount(false);
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
    <div className="space-y-4">
      <h1 className="pt-1 text-[34px] leading-tight font-bold tracking-tight text-foreground">Akun</h1>

      <Segmented
        ariaLabel="Tab akun"
        value={akunTab}
        onChange={setAkunTab}
        options={AKUN_TABS.map((t) => ({ id: t.id, title: t.title }))}
      />

      {/* Profil */}
      <Panel className={`gap-3.5 p-4 ${akunTab === 'akun' ? 'flex items-center' : 'hidden'}`}>
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary text-xl font-semibold text-primary">
          {initial}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[17px] font-semibold text-foreground">{user?.name || 'Pengguna Spendly'}</p>
          <p className="truncate text-[13px] text-muted-foreground">{user?.email || ''}</p>
        </div>
      </Panel>

      {/* Gmail + sinkronisasi */}
      <div className={akunTab === 'sinkron' ? '' : 'hidden'}>
        <SectionTitle>Gmail</SectionTitle>
        <Panel className="p-4">
          {loading ? (
            <Skeleton className="h-12 w-full rounded-xl bg-secondary" />
          ) : conns.length === 0 ? (
            <div className="space-y-3">
              <p className="text-[15px] leading-relaxed text-muted-foreground">
                Hubungkan Gmail agar struk dan notifikasi transaksi terbaca otomatis. Hanya pengirim yang kamu izinkan yang dibaca.
              </p>
              <button
                type="button"
                onClick={connectGmail}
                className="inline-flex h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-[17px] font-semibold text-white cursor-pointer active:scale-[0.99]"
              >
                <Mail className="h-5 w-5" /> Hubungkan Gmail
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {conns.map((c) => (
                <div key={c.id} className="rounded-xl bg-secondary px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Mail className="h-5 w-5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-[17px] text-foreground">{c.google_email || 'Gmail terhubung'}</span>
                    <span className={`shrink-0 text-[13px] ${
                      c.status === 'active' ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400'
                    }`}>
                      {c.status}
                    </span>
                    <button type="button" onClick={() => onDisconnect(c.id)} disabled={busy === 'dc'} className="shrink-0 text-[15px] text-destructive cursor-pointer">
                      Putus
                    </button>
                  </div>
                  {c.status === 'needs_reauth' && (
                    <div className="mt-2.5 space-y-2 border-t border-border pt-2.5">
                      <p className="text-[13px] leading-relaxed text-orange-600 dark:text-orange-400">
                        Akses Gmail terputus. Hubungkan ulang agar sinkronisasi bisa jalan lagi.
                      </p>
                      <button
                        type="button"
                        onClick={connectGmail}
                        className="inline-flex h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-[15px] font-semibold text-white cursor-pointer active:scale-[0.99]"
                      >
                        <RefreshCw className="h-4 w-4" /> Hubungkan ulang Gmail
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {status && (
                <p className="text-[13px] text-muted-foreground">
                  sync terakhir: {status.last_synced_at ? new Date(status.last_synced_at).toLocaleString('id-ID') : 'belum pernah'}
                  {status.total_scanned ? ` · ${status.total_scanned} email dipindai` : ''}
                </p>
              )}

              {/* Email yang dibaca — di atas pengaturan scan agar tidak lupa dicentang */}
              <button
                type="button"
                onClick={() => setSenderOpen(true)}
                className="inline-flex h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-secondary text-[15px] font-semibold text-primary cursor-pointer active:scale-[0.99]"
              >
                <Plus className="h-4 w-4" /> Tambah pengirim
              </button>

              {senders.length > 0 && (() => {
                const query = senderSearch.trim().toLowerCase();
                const filtered = senders.filter((s) => {
                  if (!query) return true;
                  return (
                    (s.label && s.label.toLowerCase().includes(query)) ||
                    (s.domain && s.domain.toLowerCase().includes(query)) ||
                    (s.category && s.category.toLowerCase().includes(query))
                  );
                });

                // Group by category
                const CATEGORY_ORDER = [
                  'Banks',
                  'Digital Banks',
                  'E-Wallet',
                  'Payment / Fintech',
                  'Marketplace',
                  'Travel',
                  'Lainnya',
                ];

                const grouped = filtered.reduce((acc, s) => {
                  const cat = s.category || 'Lainnya';
                  if (!acc[cat]) acc[cat] = [];
                  acc[cat].push(s);
                  return acc;
                }, {});

                const categories = [
                  ...CATEGORY_ORDER.filter((c) => grouped[c]),
                  ...Object.keys(grouped).filter((c) => !CATEGORY_ORDER.includes(c)),
                ];

                return (
                  <div className="pt-1 space-y-3">
                    <div className="flex items-center justify-between gap-2 px-4">
                      <p className="text-[13px] text-muted-foreground">
                        Email yang dibaca ({senders.filter((s) => s.allowed).length}/{senders.length})
                      </p>
                    </div>

                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={senderSearch}
                        onValueChange={setSenderSearch}
                        placeholder="Cari pengirim"
                        aria-label="Cari pengirim"
                        className="h-9 rounded-[10px] pl-9 text-[17px]"
                      />
                    </div>

                    <div className="max-h-96 space-y-4 overflow-y-auto pr-0.5">
                      {filtered.length === 0 ? (
                        <p className="text-center text-[15px] text-muted-foreground py-4">Tidak ada pengirim yang cocok dengan "{senderSearch}"</p>
                      ) : (
                        categories.map((cat) => (
                          <div key={cat}>
                            <p className="mb-1.5 px-4 text-[13px] text-muted-foreground">{cat}</p>
                            <Panel className="divide-y divide-border/60">
                              {grouped[cat].map((s) => (
                                <div key={s.domain} className="flex min-w-0 items-center gap-3 px-4 py-2.5">
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-[17px] text-foreground" title={s.label || s.domain}>{s.label || s.domain}</p>
                                    <p className="truncate text-[13px] text-muted-foreground" title={s.domain}>{s.domain}</p>
                                  </div>
                                  {s.can_delete && (
                                    <button
                                      type="button"
                                      onClick={() => setPendingSender(s)}
                                      disabled={busy === `del:${s.id}`}
                                      aria-label="Hapus pengirim"
                                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground active:bg-secondary active:text-destructive disabled:opacity-50 cursor-pointer"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  )}
                                  <Switch
                                    checked={!!s.allowed}
                                    label={`Izinkan ${s.domain}`}
                                    onChange={() => toggleSender(s.domain, s.allowed)}
                                  />
                                </div>
                              ))}
                            </Panel>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Pengaturan scan */}
              <div className="space-y-3">
                <p className="px-4 text-[13px] text-muted-foreground">Pengaturan scan</p>
                <Panel className="divide-y divide-border/60">
                  <label className="flex items-center gap-2 px-4 py-2.5">
                    <span className="flex-1 text-[17px] text-foreground">Jendela email</span>
                    <span className="relative flex items-center">
                      <select
                        value={scan.window}
                        onChange={(e) => (e.target.value === 'custom' ? setScan({ ...scan, window: 'custom' }) : saveScan({ ...scan, window: e.target.value }))}
                        aria-label="Jendela email"
                        className="cursor-pointer appearance-none bg-transparent pr-5 text-right text-[17px] text-muted-foreground outline-none"
                      >
                        {WINDOWS.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
                      </select>
                      <ChevronRight className="pointer-events-none absolute right-0 h-4 w-4 text-muted-foreground" />
                    </span>
                  </label>
                  <label className="flex items-center gap-2 px-4 py-2.5">
                    <span className="flex-1 text-[17px] text-foreground">Batas email</span>
                    <span className="relative flex items-center">
                      <select
                        value={[25, 50, 100, 200, 500, 1000].includes(Number(scan.limit)) ? String(Number(scan.limit)) : 'custom'}
                        onChange={(e) => (e.target.value === 'custom' ? setScan({ ...scan, limit: '' }) : saveScan({ ...scan, limit: Number(e.target.value) }))}
                        aria-label="Batas email per sinkronisasi"
                        className="cursor-pointer appearance-none bg-transparent pr-5 text-right text-[17px] text-muted-foreground outline-none"
                      >
                        {[25, 50, 100, 200, 500, 1000].map((l) => <option key={l} value={String(l)}>{l}</option>)}
                        <option value="custom">Kustom…</option>
                      </select>
                      <ChevronRight className="pointer-events-none absolute right-0 h-4 w-4 text-muted-foreground" />
                    </span>
                  </label>
                </Panel>

                {![25, 50, 100, 200, 500, 1000].includes(Number(scan.limit)) && (
                  <Panel className="flex items-center gap-2 px-4 py-2.5">
                    <span className="flex-1 text-[17px] text-foreground">Jumlah kustom</span>
                    <Input
                      value={String(scan.limit ?? '')}
                      onValueChange={(v) => setScan({ ...scan, limit: v.replace(/[^0-9]/g, '') })}
                      onBlur={commitLimit}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                      inputMode="numeric"
                      autoFocus
                      aria-label="Jumlah email kustom"
                      className="tnum h-9 w-24 rounded-none bg-transparent px-0 text-right text-[17px]"
                    />
                  </Panel>
                )}

                {scan.window === 'custom' && (
                  <div className="space-y-2">
                    <p className="text-[13px] text-muted-foreground">Rentang tanggal</p>
                    <div className="flex items-center gap-2">
                      <Input type="date" value={scan.from} onValueChange={(v) => setScan({ ...scan, from: v })} aria-label="Dari tanggal" className="h-11 flex-1" />
                      <span className="text-[13px] text-muted-foreground">s/d</span>
                      <Input type="date" value={scan.to} onValueChange={(v) => setScan({ ...scan, to: v })} aria-label="Sampai tanggal" className="h-11 flex-1" />
                    </div>
                    <button
                      type="button"
                      onClick={applyCustomRange}
                      className="h-[44px] w-full rounded-xl bg-primary text-[15px] font-semibold text-white cursor-pointer active:scale-[0.99]"
                    >
                      Terapkan rentang
                    </button>
                  </div>
                )}

                <p className="px-4 text-[13px] leading-relaxed text-muted-foreground">
                  {scan.window === 'custom'
                    ? `Scan email dalam rentang ${scan.from || '…'} s/d ${scan.to || '…'}, maksimal ${scan.limit || 100} email.`
                    : scan.window === 'month'
                      ? `Hanya email dari pengirim terpilih sejak tanggal 1 bulan ini, maksimal ${scan.limit || 100} email per sinkronisasi.`
                      : `Hanya email dari pengirim terpilih, ${windowDays(scan.window)} hari terakhir, maksimal ${scan.limit || 100} email per sinkronisasi.`}
                  {' '}Sync hanya jalan saat kamu klik.
                </p>
              </div>

              {/* Progres job */}
              {p && (
                <div className="space-y-2 rounded-xl bg-secondary p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-[13px] text-muted-foreground">{p.status === 'paused' ? 'Dijeda' : p.status === 'canceling' ? 'Menghentikan…' : p.status === 'done' ? 'Selesai' : p.status === 'error' ? 'Gagal' : 'Berjalan'}</p>
                    <span className="tnum text-[13px] text-muted-foreground">{p.processed}/{p.total || '?'}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/15">
                    {isIndeterminate ? (
                      <div className="h-full w-1/3 rounded-full bg-primary animate-pulse" />
                    ) : (
                      <div
                        className={`h-full rounded-full ${p.status === 'error' ? 'bg-destructive' : 'bg-primary'} transition-[width] duration-300`}
                        style={{ width: `${Math.max(2, pct)}%` }}
                      />
                    )}
                  </div>
                  <p className="truncate text-[13px] text-muted-foreground">{p.current || p.message}</p>
                  <div className="flex gap-2">
                    {p.status === 'running' && (
                      <button type="button" onClick={() => control('pause')} className="inline-flex h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-card text-[15px] font-semibold text-primary cursor-pointer active:scale-[0.98]">
                        <Pause className="h-4 w-4" /> Jeda
                      </button>
                    )}
                    {p.status === 'paused' && (
                      <button type="button" onClick={() => control('resume')} className="inline-flex h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary text-[15px] font-semibold text-white cursor-pointer active:scale-[0.98]">
                        <Play className="h-4 w-4" /> Lanjut
                      </button>
                    )}
                    {jobActive && (
                      <button type="button" onClick={() => control('cancel')} className="inline-flex h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-card text-[15px] font-semibold text-destructive cursor-pointer active:scale-[0.98]">
                        <Square className="h-4 w-4" /> Hentikan
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
                  className="inline-flex h-[50px] flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-[17px] font-semibold text-white disabled:opacity-50 cursor-pointer active:scale-[0.99]"
                >
                  <RefreshCw className="h-5 w-5" /> Sync
                </button>
                <button
                  type="button"
                  onClick={() => runSync(true)}
                  disabled={!!jobActive}
                  className="inline-flex h-[50px] flex-1 items-center justify-center gap-2 rounded-xl bg-secondary text-[17px] font-semibold text-primary disabled:opacity-50 cursor-pointer active:scale-[0.99]"
                >
                  Scan ulang
                </button>
              </div>
            </div>
          )}
        </Panel>
      </div>

      {/* Tampilan */}
      <div className={akunTab === 'akun' ? '' : 'hidden'}>
        <SectionTitle>Tampilan</SectionTitle>
        <Panel className="flex items-center gap-3 px-4 py-3">
          {dark ? <Moon className="h-5 w-5 text-muted-foreground" /> : <Sun className="h-5 w-5 text-muted-foreground" />}
          <span className="flex-1 text-[17px] text-foreground">Mode gelap</span>
          <Switch checked={dark} label="Mode gelap" onChange={() => setDark(toggleTheme() === 'dark')} />
        </Panel>
      </div>

      {/* Aplikasi: install PWA (muncul bila browser mengizinkan) */}
      {canInstall && (
        <div className={akunTab === 'akun' ? '' : 'hidden'}>
          <SectionTitle>Aplikasi</SectionTitle>
          <Panel>
            <button
              type="button"
              onClick={install}
              className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-secondary cursor-pointer"
            >
              <Download className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block text-[17px] text-foreground">Install aplikasi</span>
                <span className="block truncate text-[13px] text-muted-foreground">Buka dari layar utama, fullscreen tanpa browser</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          </Panel>
        </div>
      )}

      {/* Akun */}
      <div className={akunTab === 'akun' ? '' : 'hidden'}>
        <SectionTitle>Akun</SectionTitle>        <Panel className="divide-y divide-border/60">
          <button
            type="button"
            onClick={onLogout}
            className="flex w-full items-center gap-3 px-4 py-3 text-left text-[17px] text-primary active:bg-secondary cursor-pointer"
          >
            <LogOut className="h-5 w-5 text-muted-foreground" /> Keluar
          </button>
          <button
            type="button"
            onClick={() => setPendingDeleteAccount(true)}
            disabled={busy === 'del'}
            className="flex w-full items-center gap-3 px-4 py-3 text-left text-[17px] text-destructive active:bg-secondary disabled:opacity-50 cursor-pointer"
          >
            <Trash2 className="h-5 w-5" /> {busy === 'del' ? 'Menghapus…' : 'Hapus akun & data'}
          </button>
        </Panel>
      </div>

      <p className={`px-4 text-center text-[13px] leading-relaxed text-muted-foreground ${akunTab === 'akun' ? '' : 'hidden'}`}>
        Spendly hanya membaca email dari pengirim yang kamu izinkan. Isi email tidak disimpan.
      </p>

      {/* Riwayat sinkronisasi */}
      <div className={akunTab === 'riwayat' ? '' : 'hidden'}>
        <SectionTitle
          action={
            <button
              type="button"
              onClick={loadHistory}
              disabled={historyLoading}
              aria-label="Muat ulang riwayat"
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground active:bg-secondary disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${historyLoading ? 'animate-spin' : ''}`} />
            </button>
          }
        >
          Riwayat sinkronisasi
        </SectionTitle>
        {historyLoading && history.length === 0 ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[68px] w-full rounded-xl bg-secondary" />)}
          </div>
        ) : history.length === 0 ? (
          <Panel className="px-6 py-10 text-center">
            <p className="text-[17px] font-semibold text-foreground">Belum ada riwayat</p>
            <p className="mx-auto mt-1 max-w-[17rem] text-[13px] leading-relaxed text-muted-foreground">
              {conns.length === 0
                ? 'Hubungkan Gmail dan jalankan sinkronisasi dulu.'
                : 'Jalankan sinkronisasi di tab Sinkron untuk melihat riwayatnya di sini.'}
            </p>
          </Panel>
        ) : (
          <Panel className="divide-y divide-border/60">
            {history.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => navigate(`/akun/sync/${h.id}`)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-secondary cursor-pointer"
              >
                <span className={`shrink-0 text-[13px] ${JOB_STATUS_STYLE[h.status] || JOB_STATUS_STYLE.canceled}`}>
                  {JOB_STATUS_LABEL[h.status] || h.status}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] text-foreground">
                    {h.mode === 'backfill' ? 'Penuh' : 'Inkremental'} · {h.new} baru · {h.gated} diabaikan · {h.extracted} diekstrak
                  </span>
                  <span className="tnum block truncate text-[13px] text-muted-foreground">
                    {h.created_at ? formatDate(h.created_at) : ''}
                    {h.message ? ` · ${h.message}` : ''}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </Panel>
        )}
      </div>

      <AddSenderDrawer open={senderOpen} onOpenChange={setSenderOpen} onAdded={load} />

      <ConfirmDialog
        open={!!pendingSender}
        onOpenChange={(open) => { if (!open) setPendingSender(null); }}
        title="Hapus pengirim ini?"
        description={pendingSender ? `${pendingSender.label || pendingSender.domain} akan dihapus dari daftar.` : ''}
        confirmLabel="Hapus"
        onConfirm={onDeleteSender}
      />

      <ConfirmDialog
        open={pendingDeleteAccount}
        onOpenChange={setPendingDeleteAccount}
        title="Hapus akun & data?"
        description="Seluruh transaksi, koneksi Gmail, dan pengaturanmu akan dihapus permanen dan tidak bisa dikembalikan."
        confirmLabel={busy === 'del' ? 'Menghapus…' : 'Ya, hapus permanen'}
        confirmWord="hapus"
        onConfirm={deleteAccount}
      />
    </div>
  );
}
