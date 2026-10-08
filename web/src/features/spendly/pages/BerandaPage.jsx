import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { motion } from 'motion/react';
import { Plus, RefreshCw, ArrowRight, Wallet, Moon, Sun } from 'lucide-react';
import { getTheme, toggleTheme } from '@/lib/theme';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { formatCurrency, getGreeting } from '@/lib/utils';
import { Panel, SectionTitle, CategoryBadge, EmptyState } from '@/features/spendly/components/primitives';
import { catMeta } from '@/features/spendly/categories';
import { useAuthStore } from '@/features/auth/store';
import { getSummary, getReport, getReviewQueue } from '@/features/spendly/api';
import { EASE_OUT, useCountUp } from '@/components/animate';

const CHART = { total: { label: 'Total', color: 'var(--chart-1)' } };

export default function BerandaPage() {
  const { openQuickAdd } = useOutletContext() || {};
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [data, setData] = useState(null);
  const [compare, setCompare] = useState(null);
  const [reviewCount, setReviewCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dark, setDark] = useState(() => getTheme() === 'dark');

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
    load();
    const h = () => load();
    window.addEventListener('spendly:refresh', h);
    return () => window.removeEventListener('spendly:refresh', h);
  }, []);

  const total = data?.total_month ?? 0;
  const animatedTotal = useCountUp(loading ? 0 : total);
  const tren = data?.tren_harian || [];
  const top = data?.top_merchant || [];
  const byCat = data?.by_category || [];
  const maxCat = Math.max(1, ...byCat.map((c) => c.total));
  const diff = compare ? total - (compare.last_month || 0) : 0;

  return (
    <div className="space-y-6">
      {/* Greeting ala iOS: large title + avatar akun */}
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-[13px] text-muted-foreground">{getGreeting()}</p>
          <h1 className="truncate text-[34px] leading-tight font-bold tracking-tight text-foreground">
            {user?.name?.split(' ')[0] || 'Pengguna'}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setDark(toggleTheme() === 'dark')}
            aria-label={dark ? 'Ganti ke mode terang' : 'Ganti ke mode gelap'}
            className="relative flex h-11 w-11 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-secondary text-muted-foreground transition-colors active:scale-95"
          >
            <Sun className={`absolute h-5 w-5 transition-all duration-300 ${dark ? 'rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100'}`} />
            <Moon className={`absolute h-5 w-5 transition-all duration-300 ${dark ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-0 opacity-0'}`} />
          </button>
          <button
            type="button"
            onClick={() => navigate('/akun')}
            aria-label="Ke akun"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary text-[17px] font-semibold text-primary cursor-pointer active:scale-95"
          >
            {(user?.name || user?.email || 'S')[0].toUpperCase()}
          </button>
        </div>
      </div>

      {/* Ringkasan bulan ini — grouped card */}
      <div>
        <Panel className="p-5">
          <p className="text-[13px] text-muted-foreground">Total bulan ini</p>
          {loading ? (
            <Skeleton className="mt-3 h-9 w-44 rounded-lg bg-secondary" />
          ) : (
            <p className="tnum mt-1 text-[34px] leading-tight font-bold tracking-tight text-foreground">{formatCurrency(Math.round(animatedTotal))}</p>
          )}
          {compare && !loading && (
            <p className="mt-1 text-[13px] text-muted-foreground">
              Bulan lalu <span className="tnum">{formatCurrency(compare.last_month)}</span> · {diff >= 0 ? 'naik' : 'turun'}{' '}
              <span className="tnum font-semibold text-foreground">{formatCurrency(Math.abs(diff))}</span>
            </p>
          )}
          <div className="mt-4 flex gap-2">
            <motion.button
              type="button"
              onClick={openQuickAdd}
              whileTap={{ scale: 0.98 }}
              className="inline-flex h-[50px] flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-2 text-[17px] font-semibold whitespace-nowrap text-white cursor-pointer"
            >
              <Plus className="h-5 w-5 shrink-0" /> Catat
            </motion.button>
            <motion.button
              type="button"
              onClick={() => navigate('/akun?tab=sinkron')}
              whileTap={{ scale: 0.98 }}
              className="inline-flex h-[50px] flex-1 items-center justify-center gap-2 rounded-xl bg-primary/15 px-2 text-[17px] font-semibold whitespace-nowrap text-primary cursor-pointer"
            >
              <RefreshCw className="h-5 w-5 shrink-0" />
              Sync
            </motion.button>
          </div>
        </Panel>
      </div>

      {reviewCount > 0 && (
        <a
          href="/transaksi?tab=review"
          className="flex items-center gap-3 rounded-xl bg-card px-4 py-3 text-[15px] text-foreground active:bg-secondary"
        >
          <span className="tnum flex h-6 min-w-6 items-center justify-center rounded-full bg-destructive px-1.5 font-mono text-xs font-semibold text-white">
            {reviewCount}
          </span>
          <span className="flex-1">transaksi perlu ditinjau</span>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </a>
      )}

      {/* Tren harian */}
      <div>
        <SectionTitle>Tren harian</SectionTitle>
        <Panel className="p-3">
          {loading ? (
            <Skeleton className="h-40 w-full rounded-lg bg-secondary" />
          ) : tren.every((d) => !d.total) ? (
            <p className="px-2 py-8 text-center text-[15px] text-muted-foreground">Belum ada pengeluaran bulan ini.</p>
          ) : (
            <ChartContainer config={CHART} className="h-40 w-full">
              <BarChart data={tren} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barCategoryGap="30%">
                <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.5} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={36} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
                <YAxis hide />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="total" fill="var(--color-total)" radius={[6, 6, 2, 2]} animationDuration={600} maxBarSize={28} />
              </BarChart>
            </ChartContainer>
          )}
        </Panel>
      </div>

      {/* Per kategori */}
      <div>
        <SectionTitle>Per kategori</SectionTitle>
        {loading ? (
          <Skeleton className="h-28 w-full rounded-xl bg-secondary" />
        ) : byCat.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="Belum ada pengeluaran"
            description="Catat manual lewat tombol + atau hubungkan Gmail agar struk terbaca otomatis."
          />
        ) : (
          <Panel className="divide-y divide-border/60">
            {byCat.map((c, i) => {
              const { color } = catMeta(c.name);
              const pct = (c.total / maxCat) * 100;
              return (
                <div key={c.name} className="flex items-center gap-3 px-4 py-3">
                  <CategoryBadge name={c.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[17px] text-foreground">{c.name}</span>
                      <span className="tnum text-[15px] font-semibold text-foreground">{formatCurrency(c.total)}</span>
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ backgroundColor: color }}
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.6, ease: EASE_OUT, delay: 0.15 + i * 0.06 }}
                      />
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
          <Panel className="divide-y divide-border/60">
            {top.map((m, i) => (
              <div
                key={m.name}
                className="flex items-center gap-3 px-4 py-3"
              >
                <span className="tnum flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-secondary text-[13px] font-medium text-muted-foreground">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-[17px] text-foreground">{m.name}</span>
                <span className="tnum shrink-0 text-[15px] font-semibold text-foreground">{formatCurrency(m.total)}</span>
              </div>
            ))}
          </Panel>
        </div>
      )}
    </div>
  );
}
