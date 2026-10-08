import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Download, Copy, TrendingUp, TrendingDown, ChevronRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { formatCurrency } from '@/lib/utils';
import { Panel, SectionTitle, CategoryBadge, Segmented } from '@/features/spendly/components/primitives';
import { catMeta } from '@/features/spendly/categories';
import client from '@/lib/client';

const CHART = { total: { label: 'Total', color: 'var(--chart-1)' } };
const PERIODS = [
  { id: 'daily', title: 'Harian' },
  { id: 'monthly', title: 'Bulanan' },
  { id: 'yearly', title: 'Tahunan' },
];

function nowMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

const years = Array.from({ length: 6 }, (_, i) => String(new Date().getFullYear() - i));

// Pilih bulan + tahun ala Settings iOS: grouped rows + native picker.
function MonthPicker({ value, years, onChange }) {
  const [y, m] = value.split('-');
  const pick = (ny, nm) => onChange(`${ny}-${nm}`);
  return (
    <Panel className="divide-y divide-border/60">
      <label className="flex items-center gap-2 px-4 py-2.5">
        <span className="flex-1 text-[17px] text-foreground">Bulan</span>
        <span className="relative flex items-center">
          <select value={m} onChange={(e) => pick(y, e.target.value)} aria-label="Pilih bulan" className="cursor-pointer appearance-none bg-transparent pr-5 text-right text-[17px] text-muted-foreground outline-none">
            {MONTHS.map((label, i) => (
              <option key={label} value={String(i + 1).padStart(2, '0')}>{label}</option>
            ))}
          </select>
          <ChevronRight className="pointer-events-none absolute right-0 h-4 w-4 text-muted-foreground" />
        </span>
      </label>
      <label className="flex items-center gap-2 px-4 py-2.5">
        <span className="flex-1 text-[17px] text-foreground">Tahun</span>
        <span className="relative flex items-center">
          <select value={y} onChange={(e) => pick(e.target.value, m)} aria-label="Pilih tahun" className="cursor-pointer appearance-none bg-transparent pr-5 text-right text-[17px] text-muted-foreground outline-none">
            {years.map((yr) => <option key={yr} value={yr}>{yr}</option>)}
          </select>
          <ChevronRight className="pointer-events-none absolute right-0 h-4 w-4 text-muted-foreground" />
        </span>
      </label>
    </Panel>
  );
}

export default function LaporanPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(() => {
    const p = searchParams.get('period');
    return PERIODS.some((x) => x.id === p) ? p : 'daily';
  });
  const [month, setMonth] = useState(nowMonth);
  const [year, setYear] = useState(() => String(new Date().getFullYear()));

  useEffect(() => {
    const p = searchParams.get('period');
    if (p && PERIODS.some((x) => x.id === p) && p !== period) {
      setPeriod(p);
    }
  }, [searchParams, period]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    (async () => {
      try {
        const params = period === 'daily' ? { month } : period === 'monthly' ? { period, year } : { period };
        const { data } = await client.get('/reports/monthly', { params });
        if (mounted) setData(data);
      } catch { if (mounted) setData(null); }
      finally { if (mounted) setLoading(false); }
    })();
    return () => { mounted = false; };
  }, [period, month, year]);

  function handlePeriodChange(pId) {
    setPeriod(pId);
    setSearchParams({ period: pId }, { replace: true });
  }

  function exportCsv() {
    window.location.href = '/api/v1/export.csv';
  }

  async function copyCsv() {
    try {
      const { data } = await client.get('/export.csv', { responseType: 'text' });
      await navigator.clipboard.writeText(typeof data === 'string' ? data : '');
      toast.success('CSV tersalin');
    } catch { toast.error('Gagal mengambil CSV'); }
  }

  // Backend lama: tren_harian. Baru: tren (monthly/yearly).
  const tren = data?.tren || data?.tren_harian || [];
  const byCat = data?.by_category || [];
  const cmp = data?.compare_last_month || null;
  const cmpYear = data?.compare_last_year || null;
  const diff = cmp ? (cmp.this_month || 0) - (cmp.last_month || 0) : 0;
  const diffYear = cmpYear ? (cmpYear.this_year || 0) - (cmpYear.last_year || 0) : 0;
  const up = period === 'monthly' ? diffYear >= 0 : diff >= 0;
  const maxCat = Math.max(1, ...byCat.map((c) => c.total));
  const trendTitle = period === 'daily' ? 'Tren harian' : period === 'monthly' ? `Tren bulanan · ${year}` : 'Tren tahunan';

  return (
    <div className="space-y-4">
      <h1 className="pt-1 text-[34px] leading-tight font-bold tracking-tight text-foreground">Laporan</h1>

      <Segmented
        ariaLabel="Periode laporan"
        value={period}
        onChange={handlePeriodChange}
        options={PERIODS}
      />

      {period === 'daily' && (
        <MonthPicker value={month} years={years} onChange={setMonth} />
      )}
      {period === 'monthly' && (
        <Panel>
          <label className="flex items-center gap-2 px-4 py-2.5">
            <span className="flex-1 text-[17px] text-foreground">Tahun</span>
            <span className="relative flex items-center">
              <select value={year} onChange={(e) => setYear(e.target.value)} aria-label="Pilih tahun" className="cursor-pointer appearance-none bg-transparent pr-5 text-right text-[17px] text-muted-foreground outline-none">
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <ChevronRight className="pointer-events-none absolute right-0 h-4 w-4 text-muted-foreground" />
            </span>
          </label>
        </Panel>
      )}

      {/* Ringkasan */}
      {period === 'daily' && cmp && (
        <Panel className="p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[13px] text-muted-foreground">Bulan lalu</p>
              <p className="tnum mt-1 text-[17px] font-semibold text-muted-foreground">{formatCurrency(cmp.last_month || 0)}</p>
            </div>
            <div className="border-l border-border pl-3 text-right">
              <p className="text-[13px] text-muted-foreground">Bulan ini</p>
              <p className="tnum mt-1 text-[17px] font-semibold text-foreground">{formatCurrency(cmp.this_month || 0)}</p>
            </div>
          </div>
          <div className={`mt-3 flex items-center justify-center gap-1.5 rounded-[10px] px-2 py-2.5 text-center text-[13px] font-medium ${
            up ? 'bg-red-500/10 text-destructive' : 'bg-green-500/10 text-green-600 dark:text-green-400'
          }`}>
            {up ? <TrendingUp className="h-4 w-4 shrink-0" /> : <TrendingDown className="h-4 w-4 shrink-0" />}
            {up ? 'Naik' : 'Turun'} <span className="tnum">{formatCurrency(Math.abs(diff))}</span> dari bulan lalu
          </div>
        </Panel>
      )}

      {period === 'monthly' && cmpYear && (
        <Panel className="p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[13px] text-muted-foreground">{Number(year) - 1}</p>
              <p className="tnum mt-1 text-[17px] font-semibold text-muted-foreground">{formatCurrency(cmpYear.last_year || 0)}</p>
            </div>
            <div className="border-l border-border pl-3 text-right">
              <p className="text-[13px] text-muted-foreground">{year}</p>
              <p className="tnum mt-1 text-[17px] font-semibold text-foreground">{formatCurrency(cmpYear.this_year || 0)}</p>
            </div>
          </div>
          <div className={`mt-3 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 rounded-[10px] px-2 py-2.5 text-center text-[13px] font-medium ${
            up ? 'bg-red-500/10 text-destructive' : 'bg-green-500/10 text-green-600 dark:text-green-400'
          }`}>
            {up ? <TrendingUp className="h-4 w-4 shrink-0" /> : <TrendingDown className="h-4 w-4 shrink-0" />}
            <span>{up ? 'Naik' : 'Turun'} <span className="tnum">{formatCurrency(Math.abs(diffYear))}</span> dari tahun lalu</span>
            {data?.avg ? <span className="tnum w-full opacity-80">rata-rata {formatCurrency(data.avg)}/bln</span> : null}
          </div>
        </Panel>
      )}

      {period === 'yearly' && data?.total != null && (
        <Panel className="p-4">
          <p className="text-[13px] text-muted-foreground">Total 6 tahun terakhir</p>
          <p className="tnum mt-1 text-[17px] font-semibold text-foreground">{formatCurrency(data.total || 0)}</p>
          {data?.avg ? <p className="tnum mt-1 text-[13px] text-muted-foreground">rata-rata {formatCurrency(data.avg)}/tahun</p> : null}
        </Panel>
      )}

      {/* Tren */}
      <div>
        <SectionTitle>{trendTitle}</SectionTitle>
        <Panel className="p-2">
          {loading ? (
            <Skeleton className="h-48 w-full rounded-lg bg-secondary" />
          ) : tren.every((d) => !d.total) ? (
            <p className="px-2 py-10 text-center text-[15px] text-muted-foreground">Belum ada data pada periode ini.</p>
          ) : (
            <ChartContainer config={CHART} className="h-48 w-full">
              <BarChart data={tren} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barCategoryGap="30%">
                <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.5} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={period === 'daily' ? 28 : 8} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
                <YAxis hide />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="total" fill="var(--color-total)" radius={[6, 6, 2, 2]} maxBarSize={28} />
              </BarChart>
            </ChartContainer>
          )}
        </Panel>
      </div>

      {/* Per kategori */}
      {byCat.length > 0 && (
        <div>
          <SectionTitle>Per kategori</SectionTitle>
          <Panel className="divide-y divide-border/60">
            {byCat.map((c) => {
              const { color } = catMeta(c.name);
              return (
                <div key={c.name} className="flex items-center gap-3 px-4 py-3">
                  <CategoryBadge name={c.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[17px] text-foreground">{c.name}</span>
                      <span className="tnum text-[15px] font-semibold text-foreground">{formatCurrency(c.total)}</span>
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full" style={{ width: `${(c.total / maxCat) * 100}%`, backgroundColor: color }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </Panel>
        </div>
      )}

      {/* Export */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={exportCsv}
          className="inline-flex h-[50px] cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary text-[17px] font-semibold text-white active:scale-[0.98]"
        >
          <Download className="h-5 w-5" /> Unduh
        </button>
        <button
          type="button"
          onClick={copyCsv}
          className="inline-flex h-[50px] cursor-pointer items-center justify-center gap-2 rounded-xl bg-secondary text-[17px] font-semibold text-primary active:scale-[0.98]"
        >
          <Copy className="h-5 w-5" /> Salin
        </button>
      </div>
    </div>
  );
}
