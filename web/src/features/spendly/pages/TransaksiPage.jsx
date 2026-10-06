import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Search, Trash2, ReceiptText, Sparkles, Inbox, RotateCcw, ChevronDown, LayoutList, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { Panel, SectionTitle, CategoryBadge, EmptyState } from '@/features/spendly/components/primitives';
import ConfirmDialog from '@/features/spendly/components/ConfirmDialog';
import TransactionDetailModal, { EmailDetailModal } from '@/features/spendly/components/TransactionDetailModal';
import { uniqueCategories } from '@/features/spendly/categories';
import {
  getTransactions, deleteTransaction, restoreTransaction, mergeTransaction, getReviewQueue, confirmReview, ignoreReview,
  getIgnored, correctIgnored, reprocessEmail, getCategories,
} from '@/features/spendly/api';

const TABS = [
  { id: 'all', title: 'Semua', icon: LayoutList },
  { id: 'review', title: 'Tinjau', icon: Sparkles },
  { id: 'ignored', title: 'Diabaikan', icon: EyeOff },
  { id: 'trash', title: 'Sampah', icon: Trash2 },
];

const RANGES = [
  { key: 'all', label: 'Semua' },
  { key: 'today', label: 'Hari ini' },
  { key: '7d', label: '7 hari' },
  { key: 'month', label: 'Bulan ini' },
  { key: 'custom', label: 'Rentang' },
];

const GROUPS = [
  { key: 'day', label: 'Per hari' },
  { key: 'month', label: 'Per bulan' },
];

function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function rangeParams(range, from, to) {
  const now = new Date();
  if (range === 'today') { const d = toISO(now); return { from: d, to: d }; }
  if (range === '7d') { const s = new Date(now); s.setDate(s.getDate() - 6); return { from: toISO(s), to: toISO(now) }; }
  if (range === 'month') { const s = new Date(now.getFullYear(), now.getMonth(), 1); return { from: toISO(s), to: toISO(now) }; }
  if (range === 'custom') return { from: from || undefined, to: to || undefined };
  return {};
}

function groupItems(items, group) {
  const map = new Map();
  for (const t of items) {
    const d = new Date(t.occurred_at);
    if (Number.isNaN(d.getTime())) continue;
    const key = group === 'month' ? `${d.getFullYear()}-${d.getMonth()}` : toISO(d);
    const label = group === 'month'
      ? d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })
      : d.toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });
    if (!map.has(key)) map.set(key, { key, label, total: 0, items: [] });
    const g = map.get(key);
    g.items.push(t);
    g.total += t.amount;
  }
  return [...map.values()];
}

// Dropdown filter ringkas (select native: aksesibel + picker bawaan di mobile).
function FilterSelect({ label, className, children, ...props }) {
  return (
    <label className="min-w-0">
      <span className="eyebrow mb-1 block">{label}</span>
      <div className="relative">
        <select
          {...props}
          className={cn(
            'h-10 w-full min-w-0 cursor-pointer appearance-none truncate rounded-full border border-border bg-card pl-3 pr-7 text-xs font-medium text-forest-ink outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
            className,
          )}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-lichen" />
      </div>
    </label>
  );
}

export default function TransaksiPage() {
  const { openQuickAdd } = useOutletContext() || {};
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') || 'all');
  const [items, setItems] = useState([]);
  const [ignoredEmails, setIgnoredEmails] = useState([]);
  const [cats, setCats] = useState([]);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [source, setSource] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [range, setRange] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [group, setGroup] = useState('day');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewTotal, setReviewTotal] = useState(0);
  const [ignoredPage, setIgnoredPage] = useState(1);
  const [ignoredTotal, setIgnoredTotal] = useState(0);
  const [ignoredEmailTotal, setIgnoredEmailTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [selectedTx, setSelectedTx] = useState(null);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const mountedRef = useRef(true);
  // Guard urutan response: hanya request terbaru yang boleh menulis state.
  // Tanpa ini, response page-1 lama yang selesai belakangan bisa menimpa
  // hasil append "Muat lagi" sehingga data berikutnya tak muncul.
  const reqRef = useRef(0);
  const searchedQRef = useRef(q);

  const load = useCallback(async (query = q, category = cat, p = 1, append = false, r = range, f = from, t = to, src = source, lo = min, hi = max) => {
    const reqId = ++reqRef.current;
    setLoading(true);
    try {
      if (tab === 'review') {
        const d = await getReviewQueue({ page: p, limit: 20 });
        if (reqId !== reqRef.current) return;
        const list = d?.items || [];
        setItems((prev) => (append ? [...prev, ...list] : list));
        setReviewTotal(d?.meta?.total ?? list.length);
        setReviewPage(p);
      } else if (tab === 'ignored') {
        const d = await getIgnored({ page: p, limit: 20 });
        if (reqId !== reqRef.current) return;
        const tx = d?.transactions || [];
        const em = d?.emails || [];
        setItems((prev) => (append ? [...prev, ...tx] : tx));
        setIgnoredEmails((prev) => (append ? [...prev, ...em] : em));
        setIgnoredTotal(d?.meta?.tx_total ?? tx.length);
        setIgnoredEmailTotal(d?.meta?.email_total ?? em.length);
        setIgnoredPage(p);
      } else {
        const rp = rangeParams(r, f, t);
        const d = await getTransactions({
          ...(query ? { q: query } : {}),
          ...(category ? { category } : {}),
          ...(src ? { source: src } : {}),
          ...(lo ? { min: lo } : {}),
          ...(hi ? { max: hi } : {}),
          ...(rp.from ? { from: rp.from } : {}),
          ...(rp.to ? { to: rp.to } : {}),
          ...(tab === 'trash' ? { deleted: 1 } : {}),
          page: p, limit: 20,
        });
        if (reqId !== reqRef.current) return;
        const list = d?.items || [];
        setItems((prev) => (append ? [...prev, ...list] : list));
        setTotal(d?.meta?.total ?? list.length);
        setPage(p);
      }
    } catch {
      if (reqId !== reqRef.current) return;
      if (!append) { setItems([]); setIgnoredEmails([]); }
    } finally {
      if (reqId === reqRef.current) setLoading(false);
    }
  }, [tab, q, cat, range, from, to, source, min, max]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setPage(1);
    setReviewPage(1);
    setIgnoredPage(1);
    // Reset items langsung agar tidak flash konten tab lama.
    setItems([]);
    setIgnoredEmails([]);
    load(q, cat, 1);
  }, [tab]);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  // Debounce pencarian: tunggu 400ms setelah user berhenti mengetik.
  // Lewati saat q belum berubah agar tidak ada request page-1 ganda di awal.
  useEffect(() => {
    if ((tab !== 'all' && tab !== 'trash') || q === searchedQRef.current) return;
    const t = setTimeout(() => {
      searchedQRef.current = q;
      load(q, cat, 1);
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  useEffect(() => {
    getCategories().then((d) => setCats(uniqueCategories(d?.items || []))).catch(() => {});
  }, []);
  useEffect(() => {
    if (params.get('add') === '1' && openQuickAdd) {
      openQuickAdd();
      setParams({}, { replace: true });
    }
    if (params.get('tab')) {
      setTab(params.get('tab'));
      setParams({}, { replace: true });
    }
  }, [params, openQuickAdd, setParams]);
  useEffect(() => {
    const h = () => load(q, cat, 1);
    window.addEventListener('spendly:refresh', h);
    return () => window.removeEventListener('spendly:refresh', h);
  }, [load, q, cat]);

  const grouped = useMemo(() => groupItems(items, group), [items, group]);

  function pickRange(r) {
    setRange(r);
    if (r !== 'custom') load(q, cat, 1, false, r, from, to);
  }

  async function onDelete(id) {
    const prev = items;
    setItems((p) => p.filter((t) => t.id !== id));
    try {
      await deleteTransaction(id);
      toast.success('Dihapus', {
        action: {
          label: 'Urungkan',
          onClick: async () => {
            try {
              await restoreTransaction(id);
              toast.success('Dikembalikan');
              load(q, cat, 1);
            } catch { toast.error('Gagal mengurungkan'); }
          },
        },
      });
    } catch {
      setItems(prev);
      toast.error('Gagal menghapus');
    }
  }

  // Konfirmasi dulu lewat modal agar tidak salah tekan.
  function askDelete(t) {
    setPendingDelete(t);
  }

  function confirmDelete() {
    const t = pendingDelete;
    setPendingDelete(null);
    if (t) onDelete(t.id);
  }

  async function onConfirm(t) {
    try {
      await confirmReview(t.id, t.category);
      toast.success('Dikonfirmasi');
      load(q, cat, 1);
    } catch (e) { toast.error(e?.response?.data?.message || 'Gagal'); }
  }

  async function onCorrect(t) {
    try {
      await correctIgnored(t.id, t.category);
      toast.success('Koreksi disimpan');
      load(q, cat, 1);
    } catch (e) { toast.error(e?.response?.data?.message || 'Gagal'); }
  }

  function TxRow({ t }) {
    const inner = (
      <>
        <CategoryBadge name={t.category} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-forest-ink">{t.merchant || t.category || 'Pengeluaran'}</p>
          {t.note && <p className="truncate text-xs text-lichen">{t.note}</p>}
          <p className="truncate font-mono text-[11px] text-lichen">
            {formatDate(t.occurred_at)} · {t.category}
            {t.payment_source ? ` · ${t.payment_source}` : ''}
            {tab === 'review' && t.confidence != null ? ` · ${Math.round(t.confidence * 100)}%` : ''}
          </p>
        </div>
        <p className="tnum shrink-0 font-mono text-sm font-medium text-forest-ink">{formatCurrency(t.amount)}</p>
      </>
    );
    return (
      <div className="px-4 py-3">
        {tab === 'trash' ? (
          <div className="flex w-full items-center gap-3 text-left">{inner}</div>
        ) : (
          <button
            type="button"
            onClick={() => setSelectedTx(t)}
            className="flex w-full cursor-pointer items-center gap-3 text-left"
          >
            {inner}
          </button>
        )}

        {tab === 'review' && (
          <div className="mt-2.5 space-y-2 pl-[52px]">
            {t.duplicate_of && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-saffron/40 bg-butter/40 px-3 py-1.5">
                <span className="text-[11px] font-medium text-saffron">Kemungkinan duplikat</span>
                <button
                  type="button"
                  onClick={() => mergeTransaction(t.id, t.duplicate_of).then(() => { toast.success('Digabung'); load(q, cat, 1); }).catch(() => toast.error('Gagal menggabung'))}
                  className="shrink-0 rounded-full border border-saffron px-3 py-1 text-[11px] font-medium text-saffron cursor-pointer"
                >
                  Gabung
                </button>
              </div>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={() => onConfirm(t)} className="flex-1 rounded-full border border-forest-ink bg-forest-ink py-2 text-xs font-medium text-white cursor-pointer">
                Benar
              </button>
              <button
                type="button"
                onClick={() => ignoreReview(t.id).then(() => { toast.success('Diabaikan'); load(q, cat, 1); })}
                className="flex-1 rounded-full border border-border py-2 text-xs font-medium text-lichen cursor-pointer"
              >
                Bukan pengeluaran
              </button>
            </div>
          </div>
        )}

        {tab === 'ignored' && (
          <div className="mt-2.5 flex gap-2 pl-[52px]">
            <button type="button" onClick={() => onCorrect(t)} className="flex-1 rounded-full border border-forest-ink py-2 text-xs font-medium text-forest-ink cursor-pointer">
              Jadikan pengeluaran
            </button>
            <button type="button" onClick={() => askDelete(t)} className="rounded-full border border-border px-3 py-2 text-xs text-lichen cursor-pointer">
              Hapus
            </button>
          </div>
        )}

        {tab === 'all' && (
          <div className="mt-1 flex justify-end">
            <button type="button" onClick={() => askDelete(t)} aria-label="Hapus" className="flex h-7 w-7 items-center justify-center rounded-sm text-lichen transition-colors hover:bg-destructive/10 hover:text-destructive cursor-pointer">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {tab === 'trash' && (
          <div className="mt-2.5 flex justify-end pl-[52px]">
            <button
              type="button"
              onClick={() => restoreTransaction(t.id).then(() => { toast.success('Dipulihkan'); load(q, cat, 1); }).catch(() => toast.error('Gagal memulihkan'))}
              className="inline-flex items-center gap-1.5 rounded-full border border-forest-ink bg-forest-ink px-4 py-2 text-xs font-medium text-white cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Pulihkan
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="font-heading text-[22px] leading-tight font-medium tracking-tight text-forest-ink">Transaksi</h1>

      {/* Tabs */}
      <div className="flex border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`-mb-px flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2.5 text-xs font-medium transition-colors cursor-pointer ${
              tab === t.id ? 'border-forest-ink text-forest-ink' : 'border-transparent text-lichen'
            }`}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.title}
          </button>
        ))}
      </div>

      {(tab === 'all' || tab === 'trash') && (
        <>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-lichen" />
            <Input
              placeholder="Cari merchant, catatan, atau kategori…"
              value={q}
              onValueChange={setQ}
              onKeyDown={(e) => { if (e.key === 'Enter') load(q, cat, 1); }}
              className="h-11 pl-10"
              aria-label="Cari transaksi"
            />
          </div>

          {/* Filter: rentang tanggal, kategori, sumber, pengelompokan */}
          <div className="grid grid-cols-2 gap-2">
            <FilterSelect label="Rentang" aria-label="Rentang tanggal" value={range} onChange={(e) => pickRange(e.target.value)}>
              {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </FilterSelect>
            <FilterSelect label="Kategori" aria-label="Filter kategori" value={cat} onChange={(e) => { setCat(e.target.value); load(q, e.target.value, 1); }}>
              <option value="">Semua</option>
              {cats.map((c) => <option key={c} value={c}>{c}</option>)}
            </FilterSelect>
            <FilterSelect label="Sumber" aria-label="Sumber transaksi" value={source} onChange={(e) => { setSource(e.target.value); load(q, cat, 1, false, range, from, to, e.target.value, min, max); }}>
              <option value="">Semua</option>
              <option value="manual">Manual</option>
              <option value="email">Email</option>
            </FilterSelect>
            <FilterSelect label="Kelompok" aria-label="Kelompok transaksi" value={group} onChange={(e) => setGroup(e.target.value)}>
              {GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
            </FilterSelect>
          </div>
          <div className="flex items-center gap-2">
            <Input type="number" inputMode="numeric" placeholder="Nominal min" value={min} onValueChange={(v) => setMin(v.replace(/[^0-9]/g, ''))} aria-label="Nominal minimum" className="h-10 flex-1" />
            <span className="text-xs text-lichen">s/d</span>
            <Input type="number" inputMode="numeric" placeholder="Nominal maks" value={max} onValueChange={(v) => setMax(v.replace(/[^0-9]/g, ''))} aria-label="Nominal maksimum" className="h-10 flex-1" />
            <button type="button" onClick={() => load(q, cat, 1, false, range, from, to, source, min, max)} className="h-10 shrink-0 rounded-full border border-forest-ink bg-forest-ink px-3 text-xs font-medium text-white cursor-pointer">
              Terapkan
            </button>
          </div>
          {range === 'custom' && (
            <div className="flex items-center gap-2">
              <Input type="date" value={from} onValueChange={setFrom} aria-label="Dari tanggal" className="h-10 flex-1" />
              <span className="text-xs text-lichen">s/d</span>
              <Input type="date" value={to} onValueChange={setTo} aria-label="Sampai tanggal" className="h-10 flex-1" />
              <button type="button" onClick={() => load(q, cat, 1, false, 'custom', from, to)} className="h-10 shrink-0 rounded-full border border-forest-ink bg-forest-ink px-3 text-xs font-medium text-white cursor-pointer">
                Terapkan
              </button>
            </div>
          )}
        </>
      )}

      {loading && items.length === 0 ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[68px] w-full rounded-lg" />)}
        </div>
      ) : items.length === 0 && ignoredEmails.length === 0 ? (
        <EmptyState
          icon={tab === 'review' ? Sparkles : tab === 'ignored' ? Inbox : tab === 'trash' ? Trash2 : ReceiptText}
          title={tab === 'all' ? 'Belum ada transaksi' : tab === 'review' ? 'Tidak ada yang perlu ditinjau' : tab === 'ignored' ? 'Belum ada yang diabaikan' : 'Sampah kosong'}
          description={
            tab === 'all'
              ? 'Catat pengeluaran manual atau hubungkan Gmail agar tercatat otomatis.'
              : tab === 'review'
                ? 'Semua hasil ekstraksi sudah jelas.'
                : tab === 'ignored'
                  ? 'Email yang dianggap bukan pengeluaran akan muncul di sini.'
                  : 'Transaksi yang dihapus akan muncul di sini dan bisa dipulihkan.'
          }
          action={tab === 'all' && (
            <button type="button" onClick={openQuickAdd} className="mt-1 rounded-full border border-forest-ink bg-forest-ink px-4 py-2 text-xs font-medium text-white cursor-pointer">
              Catat sekarang
            </button>
          )}
        />
      ) : (
        <>
          {(tab === 'all' || tab === 'trash') ? (
            <div className="space-y-4">
              {grouped.map((g) => (
                <div key={g.key}>
                  <div className="mb-1.5 flex items-baseline justify-between px-0.5">
                    <span className="eyebrow">{g.label}</span>
                    <span className="tnum font-mono text-[11px] font-medium text-lichen">{formatCurrency(g.total)}</span>
                  </div>
                  <Panel className="divide-y divide-border">
                    {g.items.map((t) => <TxRow key={t.id} t={t} />)}
                  </Panel>
                </div>
              ))}
            </div>
          ) : (
            items.length > 0 && <Panel className="divide-y divide-border">{items.map((t) => <TxRow key={t.id} t={t} />)}</Panel>
          )}

          {(tab === 'all' || tab === 'trash') && items.length < total && (
            <button
              type="button"
              onClick={() => load(q, cat, page + 1, true)}
              disabled={loading}
              className="w-full rounded-full border border-border py-3 text-xs font-medium text-lichen cursor-pointer disabled:cursor-default disabled:opacity-50"
            >
              Muat lagi ({items.length}/{total})
            </button>
          )}

          {tab === 'review' && items.length < reviewTotal && (
            <button
              type="button"
              onClick={() => load(q, cat, reviewPage + 1, true)}
              disabled={loading}
              className="w-full rounded-full border border-border py-3 text-xs font-medium text-lichen cursor-pointer disabled:cursor-default disabled:opacity-50"
            >
              Muat lagi ({items.length}/{reviewTotal})
            </button>
          )}

          {tab === 'ignored' && ignoredEmails.length > 0 && (
            <div className="pt-1">
              <SectionTitle>Email diabaikan / gagal</SectionTitle>
              <Panel className="divide-y divide-border">
                {ignoredEmails.map((e) => (
                  <div key={e.id} className="flex items-center gap-3 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setSelectedEmail(e)}
                      className="min-w-0 flex-1 cursor-pointer text-left"
                    >
                      <span className="block truncate text-xs font-medium text-forest-ink">{e.subject || '(tanpa subjek)'}</span>
                      <span className={cn('block truncate font-mono text-[11px]', e.error ? 'text-destructive' : 'text-lichen')}>
                        {e.sender_domain ? `${e.sender_domain} · ` : ''}
                        {e.error ? `gagal: ${e.error}` : (e.reason || 'bukan pengeluaran')}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => reprocessEmail(e.id).then(() => { toast.success('Dijadwalkan ulang'); load(q, cat, 1); })}
                      className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-deep-forest cursor-pointer"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Proses ulang
                    </button>
                  </div>
                ))}
              </Panel>
            </div>
          )}

          {tab === 'ignored' && (items.length < ignoredTotal || ignoredEmails.length < ignoredEmailTotal) && (
            <button
              type="button"
              onClick={() => load(q, cat, ignoredPage + 1, true)}
              disabled={loading}
              className="w-full rounded-full border border-border py-3 text-xs font-medium text-lichen cursor-pointer disabled:cursor-default disabled:opacity-50"
            >
              Muat lagi
            </button>
          )}
        </>
      )}

      <TransactionDetailModal
        tx={selectedTx}
        categories={cats.length ? cats : uniqueCategories([])}
        onClose={() => setSelectedTx(null)}
        onUpdated={(next) => {
          setItems((prev) => prev.map((x) => (x.id === next.id ? next : x)));
          setSelectedTx(next);
        }}
        onDelete={(t) => { setSelectedTx(null); askDelete(t); }}
      />
      <EmailDetailModal
        email={selectedEmail}
        onClose={() => setSelectedEmail(null)}
        onReprocess={(e) => {
          setSelectedEmail(null);
          reprocessEmail(e.id).then(() => { toast.success('Dijadwalkan ulang'); load(q, cat, 1); });
        }}
      />
      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        title="Hapus transaksi ini?"
        description={pendingDelete
          ? `${pendingDelete.merchant || pendingDelete.category || 'Transaksi'} · ${formatCurrency(pendingDelete.amount)} akan dihapus.`
          : ''}
        confirmLabel="Hapus"
        onConfirm={confirmDelete}
      />
    </div>
  );
}
