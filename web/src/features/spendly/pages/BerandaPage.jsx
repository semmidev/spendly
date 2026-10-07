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
import { EASE_OUT, fadeUp, stagger, useCountUp } from '@/components/animate';

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
    <motion.div className="space-y-6" variants={stagger(0.08)} initial="hidden" animate="show">
      {/* Greeting + avatar (pengganti header) */}
      <motion.div variants={fadeUp} className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-[13px] text-lichen">{getGreeting()}</p>
          <h1 className="truncate font-heading text-[22px] leading-tight font-medium tracking-tight text-forest-ink">
            {user?.name?.split(' ')[0] || 'Pengguna'}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setDark(toggleTheme() === 'dark')}
            aria-label={dark ? 'Ganti ke mode terang' : 'Ganti ke mode gelap'}
            className="relative flex h-10 w-10 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-border bg-card text-lichen transition-colors hover:text-forest-ink"
          >
            <Sun className={`absolute h-[18px] w-[18px] transition-all duration-300 ${dark ? 'rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100'}`} />
            <Moon className={`absolute h-[18px] w-[18px] transition-all duration-300 ${dark ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-0 opacity-0'}`} />
          </button>
          <button
            type="button"
            onClick={() => navigate('/akun')}
            aria-label="Ke akun"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-meadow text-sm font-medium text-forest-ink cursor-pointer"
          >
            {(user?.name || user?.email || 'S')[0].toUpperCase()}
          </button>
        </div>
      </motion.div>

      {/* Total — jangkar gelap di atas perkamen */}
      <motion.div variants={fadeUp}>
        <Panel className="panel-hero border-forest-ink bg-forest-ink p-5 text-white shadow-md">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-white/70">Total bulan ini</p>
          {loading ? (
            <Skeleton className="mt-3 h-9 w-44 rounded-md bg-white/15" />
          ) : (
            <p className="tnum mt-2 text-[32px] leading-none font-medium tracking-tight">{formatCurrency(Math.round(animatedTotal))}</p>
          )}
          {compare && !loading && (
            <p className="mt-2 text-xs text-white/70">
              Bulan lalu <span className="tnum">{formatCurrency(compare.last_month)}</span> · {diff >= 0 ? 'naik' : 'turun'}{' '}
              <span className="tnum font-medium text-white">{formatCurrency(Math.abs(diff))}</span>
            </p>
          )}
          <div className="mt-4 flex gap-2">
            <motion.button
              type="button"
              onClick={openQuickAdd}
              whileTap={{ scale: 0.97 }}
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-white px-2 text-sm font-medium whitespace-nowrap text-forest-ink transition-colors hover:bg-white/90 dark:bg-[#dcebd2] dark:text-[#0b1a1a] cursor-pointer"
            >
              <Plus className="h-4 w-4 shrink-0" /> Catat Manual
            </motion.button>
            <motion.button
              type="button"
              onClick={() => navigate('/akun?tab=sinkron')}
              whileTap={{ scale: 0.97 }}
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full border-[1.5px] border-white/40 bg-transparent px-2 text-sm font-medium whitespace-nowrap text-white transition-colors hover:bg-white/10 cursor-pointer"
            >
              <RefreshCw className="h-4 w-4 shrink-0" />
              Sync Email
            </motion.button>
          </div>
        </Panel>
      </motion.div>

      {reviewCount > 0 && (
        <motion.a
          variants={fadeUp}
          href="/transaksi?tab=review"
          whileTap={{ scale: 0.99 }}
          className="flex items-center gap-3 rounded-lg border border-forest-ink/20 bg-butter px-4 py-3 text-sm text-forest-ink"
        >
          <span className="tnum flex h-6 min-w-6 items-center justify-center rounded-full bg-forest-ink px-1.5 font-mono text-xs font-medium text-white">
            {reviewCount}
          </span>
          <span className="flex-1 font-medium">transaksi perlu ditinjau</span>
          <ArrowRight className="h-4 w-4" />
        </motion.a>
      )}

      {/* Tren harian */}
      <motion.div variants={fadeUp}>
        <SectionTitle>Tren harian</SectionTitle>
        <Panel className="p-3">
          {loading ? (
            <Skeleton className="h-40 w-full rounded-sm" />
          ) : tren.every((d) => !d.total) ? (
            <p className="px-2 py-8 text-center text-sm text-lichen">Belum ada pengeluaran bulan ini.</p>
          ) : (
            <ChartContainer config={CHART} className="h-40 w-full">
              <BarChart data={tren} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={36} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
                <YAxis hide />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="total" fill="var(--color-total)" radius={[2, 2, 0, 0]} animationDuration={600} />
              </BarChart>
            </ChartContainer>
          )}
        </Panel>
      </motion.div>

      {/* Per kategori */}
      <motion.div variants={fadeUp}>
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
            {byCat.map((c, i) => {
              const { color } = catMeta(c.name);
              const pct = (c.total / maxCat) * 100;
              return (
                <div key={c.name} className="flex items-center gap-3 px-4 py-3">
                  <CategoryBadge name={c.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium text-forest-ink">{c.name}</span>
                      <span className="tnum font-mono text-sm font-medium text-forest-ink">{formatCurrency(c.total)}</span>
                    </div>
                    <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-border">
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
      </motion.div>

      {/* Top merchant */}
      {top.length > 0 && (
        <motion.div variants={fadeUp}>
          <SectionTitle>Merchant teratas</SectionTitle>
          <Panel className="divide-y divide-border">
            {top.map((m, i) => (
              <motion.div
                key={m.name}
                className="flex items-center gap-3 px-4 py-3"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.35, ease: EASE_OUT, delay: 0.1 + i * 0.05 }}
              >
                <span className="tnum flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-border font-mono text-xs font-medium text-lichen">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-forest-ink">{m.name}</span>
                <span className="tnum font-mono text-sm font-medium text-forest-ink">{formatCurrency(m.total)}</span>
              </motion.div>
            ))}
          </Panel>
        </motion.div>
      )}
    </motion.div>
  );
}
