import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Download, Copy, TrendingUp, TrendingDown } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { formatCurrency } from '@/lib/utils';
import { Panel, SectionTitle, CategoryBadge } from '@/features/spendly/components/primitives';
import { catMeta } from '@/features/spendly/categories';
import client from '@/lib/client';

const CHART = { total: { label: 'Total', color: '#2a4e1c' } };

export default function LaporanPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await client.get('/reports/monthly');
        if (mounted) setData(data);
      } catch { if (mounted) setData(null); }
      finally { if (mounted) setLoading(false); }
    })();
    return () => { mounted = false; };
  }, []);

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

  const tren = data?.tren_harian || [];
  const byCat = data?.by_category || [];
  const cmp = data?.compare_last_month || { this_month: 0, last_month: 0 };
  const diff = (cmp.this_month || 0) - (cmp.last_month || 0);
  const up = diff >= 0;
  const maxCat = Math.max(1, ...byCat.map((c) => c.total));

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-[22px] leading-tight font-medium tracking-tight text-forest-ink">Laporan</h1>

      {/* Bulan lalu vs bulan ini */}
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
        <div className={`mt-3 flex items-center justify-center gap-1.5 rounded-sm border py-2 text-xs font-medium ${
          up ? 'border-saffron/40 bg-butter text-saffron' : 'border-deep-forest/30 bg-sage text-deep-forest'
        }`}>
          {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
          {up ? 'Naik' : 'Turun'} <span className="tnum font-mono">{formatCurrency(Math.abs(diff))}</span> dari bulan lalu
        </div>
      </Panel>

      {/* Tren harian */}
      <div>
        <SectionTitle>Tren harian</SectionTitle>
        <Panel className="p-3">
          {loading ? (
            <Skeleton className="h-48 w-full rounded-sm" />
          ) : tren.every((d) => !d.total) ? (
            <p className="px-2 py-10 text-center text-sm text-lichen">Belum ada data bulan ini.</p>
          ) : (
            <ChartContainer config={CHART} className="h-48 w-full">
              <BarChart data={tren} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#e4e1d3" strokeDasharray="2 4" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} tick={{ fontSize: 10, fill: '#5c7070' }} />
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
          className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-forest-ink bg-transparent text-sm font-medium text-forest-ink transition-colors hover:bg-forest-ink/5 cursor-pointer"
        >
          <Download className="h-4 w-4" /> Unduh CSV
        </button>
        <button
          type="button"
          onClick={copyCsv}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-forest-ink bg-transparent text-sm font-medium text-forest-ink transition-colors hover:bg-forest-ink/5 cursor-pointer"
        >
          <Copy className="h-4 w-4" /> Salin CSV
        </button>
      </div>
    </div>
  );
}
