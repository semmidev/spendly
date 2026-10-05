import { useEffect, useRef, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus, RefreshCw, ArrowRight, Wallet } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { formatCurrency } from '@/lib/utils';
import { Panel, SectionTitle, CategoryBadge, EmptyState } from '@/features/spendly/components/primitives';
import { catMeta } from '@/features/spendly/categories';
import { useAuthStore } from '@/features/auth/store';
import { getSummary, getReport, getReviewQueue, startGmailSync, syncEventsUrl } from '@/features/spendly/api';

const CHART = { total: { label: 'Total', color: '#2a4e1c' } };

export default function BerandaPage() {
  const { openQuickAdd } = useOutletContext() || {};
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [data, setData] = useState(null);
  const [compare, setCompare] = useState(null);
  const [reviewCount, setReviewCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const esRef = useRef(null);
  const mountedRef = useRef(true);

  async function load() {
    setLoading(true);
    try {
      const [s, r, q] = await Promise.all([
        getSummary(),
        getReport().catch(() => null),
        getReviewQueue().catch(() => []),
      ]);
      setData(s);
      setCompare(r?.compare_last_month || null);
      setReviewCount((q || []).length);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    load();
    const h = () => load();
    window.addEventListener('spendly:refresh', h);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('spendly:refresh', h);
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, []);

  async function onSync() {
    setSyncing(true);
    try {
      const { job_id } = await startGmailSync({});
      toast('Sinkronisasi Gmail dimulai…');
      if (esRef.current) esRef.current.close();
      const es = new EventSource(syncEventsUrl(job_id));
      esRef.current = es;
      es.onmessage = (e) => {
        let p;
        try { p = JSON.parse(e.data); } catch { return; }
        if (!mountedRef.current) { es.close(); return; }
        if (['done', 'error', 'canceled'].includes(p.status)) {
          es.close();
          if (esRef.current === es) esRef.current = null;
          if (p.status === 'done') toast.success(`Selesai: ${p.new} baru, ${p.extracted} diekstrak`);
          else if (p.status === 'error') toast.error(p.message || 'Sinkronisasi gagal');
          if (mountedRef.current) { setSyncing(false); load(); }
        }
      };
      es.onerror = () => {
        if (!esRef.current) return;
        import('@/features/spendly/api').then(({ getSyncJob }) =>
          getSyncJob(job_id)
            .then(({ progress }) => {
              if (!mountedRef.current) { es.close(); esRef.current = null; return; }
              if (progress && ['done', 'error', 'canceled'].includes(progress.status)) {
                es.close();
                esRef.current = null;
                if (mountedRef.current) { setSyncing(false); load(); }
              }
            })
            .catch(() => { es.close(); esRef.current = null; if (mountedRef.current) setSyncing(false); })
        );
      };
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Gagal sinkronisasi');
      if (mountedRef.current) setSyncing(false);
    }
  }

  const total = data?.total_month ?? 0;
  const tren = data?.tren_harian || [];
  const top = data?.top_merchant || [];
  const byCat = data?.by_category || [];
  const maxCat = Math.max(1, ...byCat.map((c) => c.total));
  const diff = compare ? total - (compare.last_month || 0) : 0;

  return (
    <div className="space-y-6">
      {/* Greeting + avatar (pengganti header) */}
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-[13px] text-lichen">Hai, selamat datang</p>
          <h1 className="truncate font-heading text-[22px] leading-tight font-medium tracking-tight text-forest-ink">
            {user?.name?.split(' ')[0] || 'Pengguna'}
          </h1>
        </div>
        <button
          type="button"
          onClick={() => navigate('/akun')}
          aria-label="Ke akun"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-meadow text-sm font-medium text-forest-ink cursor-pointer"
        >
          {(user?.name || user?.email || 'S')[0].toUpperCase()}
        </button>
      </div>

      {/* Total — jangkar gelap di atas perkamen */}
      <Panel className="border-forest-ink bg-forest-ink p-5 text-white shadow-md">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-white/70">Total bulan ini</p>
        {loading ? (
          <Skeleton className="mt-3 h-9 w-44 rounded-md bg-white/15" />
        ) : (
          <p className="tnum mt-2 text-[32px] leading-none font-medium tracking-tight">{formatCurrency(total)}</p>
        )}
        {compare && !loading && (
          <p className="mt-2 text-xs text-white/70">
            Bulan lalu <span className="tnum">{formatCurrency(compare.last_month)}</span> · {diff >= 0 ? 'naik' : 'turun'}{' '}
            <span className="tnum font-medium text-white">{formatCurrency(Math.abs(diff))}</span>
          </p>
        )}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={openQuickAdd}
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-white text-sm font-medium text-forest-ink transition-colors hover:bg-white/90 cursor-pointer"
          >
            <Plus className="h-4 w-4" /> Catat
          </button>
          <button
            type="button"
            onClick={onSync}
            disabled={syncing}
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full border-[1.5px] border-white/40 bg-transparent text-sm font-medium text-white transition-colors hover:bg-white/10 disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Sync…' : 'Sync Gmail'}
          </button>
        </div>
      </Panel>

      {reviewCount > 0 && (
        <a
          href="/transaksi?tab=review"
          className="flex items-center gap-3 rounded-lg border border-forest-ink/20 bg-butter px-4 py-3 text-sm text-forest-ink"
        >
          <span className="tnum flex h-6 min-w-6 items-center justify-center rounded-full bg-forest-ink px-1.5 font-mono text-xs font-medium text-white">
            {reviewCount}
          </span>
          <span className="flex-1 font-medium">transaksi perlu ditinjau</span>
          <ArrowRight className="h-4 w-4" />
        </a>
      )}

      {/* Tren harian */}
      <div>
        <SectionTitle>Tren harian</SectionTitle>
        <Panel className="p-3">
          {loading ? (
            <Skeleton className="h-40 w-full rounded-sm" />
          ) : tren.every((d) => !d.total) ? (
            <p className="px-2 py-8 text-center text-sm text-lichen">Belum ada pengeluaran bulan ini.</p>
          ) : (
            <ChartContainer config={CHART} className="h-40 w-full">
              <BarChart data={tren} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#dcdcdc" strokeDasharray="2 4" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={36} tick={{ fontSize: 10, fill: '#706f6f' }} />
                <YAxis hide />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="total" fill="var(--color-total)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ChartContainer>
          )}
        </Panel>
      </div>

      {/* Per kategori */}
      <div>
        <SectionTitle>Per kategori</SectionTitle>
        {loading ? (
          <Skeleton className="h-28 w-full rounded-lg" />
        ) : byCat.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="Belum ada pengeluaran"
            description="Catat manual lewat tombol + atau hubungkan Gmail agar struk terbaca otomatis."
          />
        ) : (
          <Panel className="divide-y divide-border">
            {byCat.map((c) => {
              const { color } = catMeta(c.name);
              return (
                <div key={c.name} className="flex items-center gap-3 px-4 py-3">
                  <CategoryBadge name={c.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium text-forest-ink">{c.name}</span>
                      <span className="tnum font-mono text-sm font-medium text-forest-ink">{formatCurrency(c.total)}</span>
                    </div>
                    <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-border">
                      <div className="h-full rounded-full" style={{ width: `${(c.total / maxCat) * 100}%`, backgroundColor: color }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </Panel>
        )}
      </div>

      {/* Top merchant */}
      {top.length > 0 && (
        <div>
          <SectionTitle>Merchant teratas</SectionTitle>
          <Panel className="divide-y divide-border">
            {top.map((m, i) => (
              <div key={m.name} className="flex items-center gap-3 px-4 py-3">
                <span className="tnum flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-border font-mono text-xs font-medium text-lichen">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-forest-ink">{m.name}</span>
                <span className="tnum font-mono text-sm font-medium text-forest-ink">{formatCurrency(m.total)}</span>
              </div>
            ))}
          </Panel>
        </div>
      )}
    </div>
  );
}
