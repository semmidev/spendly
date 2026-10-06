import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Download, Copy, TrendingUp, TrendingDown } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { formatCurrency } from '@/lib/utils';
import { Panel, SectionTitle, CategoryBadge, Chip } from '@/features/spendly/components/primitives';
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

const SELECT_CLS = 'h-10 w-full cursor-pointer appearance-none rounded-full border border-border bg-card px-3 text-xs font-medium text-forest-ink outline-none';

// Pilih bulan + tahun via dropdown (pengganti input month manual).
function MonthPicker({ value, years, onChange }) {
  const [y, m] = value.split('-');
  const pick = (ny, nm) => onChange(`${ny}-${nm}`);
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="min-w-0">
        <span className="eyebrow mb-1 block">Bulan</span>
        <select value={m} onChange={(e) => pick(y, e.target.value)} aria-label="Pilih bulan" className={SELECT_CLS}>
          {MONTHS.map((label, i) => (
            <option key={label} value={String(i + 1).padStart(2, '0')}>{label}</option>
          ))}
        </select>
      </label>
      <label className="min-w-0">
        <span className="eyebrow mb-1 block">Tahun</span>
        <select value={y} onChange={(e) => pick(e.target.value, m)} aria-label="Pilih tahun" className={SELECT_CLS}>
          {years.map((yr) => <option key={yr} value={yr}>{yr}</option>)}
        </select>
      </label>
    </div>
  );
}

export default function LaporanPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('daily');
  const [month, setMonth] = useState(nowMonth);
  const [year, setYear] = useState(() => String(new Date().getFullYear()));

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
  const years = Array.from({ length: 6 }, (_, i) => String(new Date().getFullYear() - i));

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-[22px] leading-tight font-medium tracking-tight text-forest-ink">Laporan</h1>

      <div className="flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <Chip key={p.id} active={period === p.id} onClick={() => setPeriod(p.id)}>{p.title}</Chip>
        ))}
      </div>

      {period === 'daily' && (
        <MonthPicker value={month} years={years} onChange={setMonth} />
      )}
      {period === 'monthly' && (
        <label className="block max-w-52">
          <span className="eyebrow mb-1 block">Tahun</span>
          <select value={year} onChange={(e) => setYear(e.target.value)} aria-label="Pilih tahun" className={SELECT_CLS}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      )}

      {/* Ringkasan */}
      {period === 'daily' && cmp && (
        <Panel className="border-forest-ink/15 bg-mint p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="eyebrow">Bulan lalu</p>
              <p className="tnum mt-1.5 font-mono text-base font-medium text-lichen">{formatCurrency(cmp.last_month || 0)}</p>
            </div>
            <div className="border-l border-forest-ink/15 pl-3 text-right">
              <p className="eyebrow">Bulan ini</p>
              <p className="tnum mt-1.5 font-mono text-base font-medium text-forest-ink">{formatCurrency(cmp.this_month || 0)}</p>
            </div>
          </div>
          <div className={`mt-3 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 rounded-sm border px-2 py-2 text-center text-xs font-medium ${
            up ? 'border-saffron/40 bg-butter text-saffron' : 'border-deep-forest/30 bg-sage text-deep-forest'
          }`}>
            {up ? <TrendingUp className="h-3.5 w-3.5 shrink-0" /> : <TrendingDown className="h-3.5 w-3.5 shrink-0" />}
            {up ? 'Naik' : 'Turun'} <span className="tnum font-mono">{formatCurrency(Math.abs(diff))}</span> dari bulan lalu
          </div>
        </Panel>
      )}

      {period === 'monthly' && cmpYear && (
        <Panel className="border-forest-ink/15 bg-mint p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="eyebrow">{Number(year) - 1}</p>
              <p className="tnum mt-1.5 font-mono text-base font-medium text-lichen">{formatCurrency(cmpYear.last_year || 0)}</p>
            </div>
            <div className="border-l border-forest-ink/15 pl-3 text-right">
              <p className="eyebrow">{year}</p>
              <p className="tnum mt-1.5 font-mono text-base font-medium text-forest-ink">{formatCurrency(cmpYear.this_year || 0)}</p>
            </div>
          </div>
          <div className={`mt-3 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 rounded-sm border px-2 py-2 text-center text-xs font-medium ${
            up ? 'border-saffron/40 bg-butter text-saffron' : 'border-deep-forest/30 bg-sage text-deep-forest'
          }`}>
            {up ? <TrendingUp className="h-3.5 w-3.5 shrink-0" /> : <TrendingDown className="h-3.5 w-3.5 shrink-0" />}
            <span>{up ? 'Naik' : 'Turun'} <span className="tnum font-mono">{formatCurrency(Math.abs(diffYear))}</span> dari tahun lalu</span>
            {data?.avg ? <span className="tnum w-full font-mono opacity-80">rata-rata {formatCurrency(data.avg)}/bln</span> : null}
          </div>
        </Panel>
      )}

      {period === 'yearly' && data?.total != null && (
        <Panel className="border-forest-ink/15 bg-mint p-4">
          <p className="eyebrow">Total 6 tahun terakhir</p>
          <p className="tnum mt-1.5 font-mono text-base font-medium text-forest-ink">{formatCurrency(data.total || 0)}</p>
          {data?.avg ? <p className="tnum mt-1 font-mono text-xs text-lichen">rata-rata {formatCurrency(data.avg)}/tahun</p> : null}
        </Panel>
      )}

      {/* Tren */}
      <div>
        <SectionTitle>{trendTitle}</SectionTitle>
        <Panel className="p-3">
          {loading ? (
            <Skeleton className="h-48 w-full rounded-sm" />
          ) : tren.every((d) => !d.total) ? (
            <p className="px-2 py-10 text-center text-sm text-lichen">Belum ada data pada periode ini.</p>
          ) : (
            <ChartContainer config={CHART} className="h-48 w-full">
              <BarChart data={tren} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={period === 'daily' ? 28 : 8} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
                <YAxis hide />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="total" fill="var(--color-total)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ChartContainer>
          )}
        </Panel>
      </div>

      {/* Per kategori */}
      {byCat.length > 0 && (
        <div>
          <SectionTitle>Per kategori</SectionTitle>
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
        </div>
      )}

      {/* Export */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={exportCsv}
          className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-full border border-forest-ink bg-transparent text-sm font-medium text-forest-ink transition-colors hover:bg-forest-ink/5"
        >
          <Download className="h-4 w-4" /> Unduh CSV
        </button>
        <button
          type="button"
          onClick={copyCsv}
          className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-full border border-forest-ink bg-transparent text-sm font-medium text-forest-ink transition-colors hover:bg-forest-ink/5"
        >
          <Copy className="h-4 w-4" /> Salin CSV
        </button>
      </div>
    </div>
  );
}
