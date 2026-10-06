import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, MailOpen } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Panel, SectionTitle, CategoryBadge } from '@/features/spendly/components/primitives';
import { getSyncDetail } from '@/features/spendly/api';

const EMAIL_STATUS_STYLE = {
  parsed: 'border-deep-forest/30 bg-sage text-deep-forest',
  needs_review: 'border-saffron/40 bg-butter text-saffron',
  ignored: 'border-border bg-mint text-lichen',
  gated_out: 'border-border bg-mint text-lichen',
  dedup: 'border-border bg-mint text-lichen',
  fetched: 'border-network/40 bg-mint text-deep-forest',
  extracting: 'border-network/40 bg-mint text-deep-forest',
  failed: 'border-destructive/40 bg-destructive/10 text-destructive',
};

const EMAIL_STATUS_LABEL = {
  parsed: 'Tercatat', needs_review: 'Tinjau', ignored: 'Diabaikan',
  gated_out: 'Diabaikan', dedup: 'Duplikat', fetched: 'Diproses',
  extracting: 'Diproses', failed: 'Gagal',
};

function durationMs(start, end) {
  if (!start || !end) return '';
  const ms = new Date(end) - new Date(start);
  if (Number.isNaN(ms) || ms < 0) return '';
  if (ms < 60_000) return `${Math.round(ms / 1000)} dtk`;
  return `${Math.round(ms / 60_000)} mnt`;
}

// Detail satu sesi sinkronisasi: ringkasan job + email yang diproses
// (subjek, pengirim, status, transaksi hasilnya).
export default function SyncDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setData(await getSyncDetail(id));
      } catch { if (mounted) setData(null); }
      finally { if (mounted) setLoading(false); }
    })();
    return () => { mounted = false; };
  }, [id]);

  const job = data?.job || null;
  const emails = data?.emails || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Kembali"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-lichen transition-colors hover:text-forest-ink cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="font-heading text-[22px] leading-tight font-medium tracking-tight text-forest-ink">Detail sinkronisasi</h1>
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-28 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      ) : !job ? (
        <Panel className="px-6 py-10 text-center">
          <p className="font-heading text-[15px] font-medium text-forest-ink">Riwayat tidak ditemukan</p>
          <p className="mx-auto mt-1 max-w-[17rem] text-xs leading-relaxed text-lichen">Mungkin sudah terhapus atau bukan milik akun ini.</p>
        </Panel>
      ) : (
        <>
          <Panel className="space-y-2.5 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="eyebrow">{job.mode === 'backfill' ? 'Pindai penuh' : 'Inkremental'}</span>
              <span className="tnum font-mono text-[11px] text-lichen">{durationMs(job.created_at, job.finished_at)}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                [job.new, 'baru'],
                [job.gated, 'diabaikan'],
                [job.extracted, 'diekstrak'],
              ].map(([v, label]) => (
                <div key={label} className="rounded-md border border-border bg-mint/50 px-2 py-2.5">
                  <p className="tnum font-mono text-base font-medium text-forest-ink">{v ?? 0}</p>
                  <p className="mt-0.5 text-[11px] text-lichen">{label}</p>
                </div>
              ))}
            </div>
            <p className="tnum font-mono text-[11px] leading-relaxed text-lichen">
              mulai {job.created_at ? formatDate(job.created_at) : '-'}
              {job.finished_at ? ` · selesai ${formatDate(job.finished_at)}` : ' · masih berjalan'}
              {job.message ? ` · ${job.message}` : ''}
            </p>
          </Panel>

          <div>
            <SectionTitle>Email diproses ({emails.length})</SectionTitle>
            {emails.length === 0 ? (
              <Panel className="px-6 py-10 text-center">
                <MailOpen className="mx-auto h-5 w-5 text-lichen" />
                <p className="mt-2 font-heading text-[15px] font-medium text-forest-ink">Tidak ada rincian email</p>
                <p className="mx-auto mt-1 max-w-[17rem] text-xs leading-relaxed text-lichen">
                  Rincian per email hanya tersedia untuk sinkronisasi setelah pembaruan ini.
                </p>
              </Panel>
            ) : (
              <Panel className="divide-y divide-border">
                {emails.map((e, i) => (
                  <div key={`${e.received_at}-${i}`} className="flex items-start gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-forest-ink">{e.subject || '(tanpa subjek)'}</p>
                      <p className="tnum truncate font-mono text-[11px] text-lichen">
                        {e.sender_domain || ''}
                        {e.received_at ? ` · ${formatDate(e.received_at)}` : ''}
                        {e.ignore_reason ? ` · ${e.ignore_reason}` : ''}
                        {e.confidence != null ? ` · ${Math.round(e.confidence * 100)}%` : ''}
                      </p>
                      {e.transaction && (
                        <p className="tnum mt-1 font-mono text-xs font-medium text-forest-ink">
                          {e.transaction.merchant || e.transaction.category || 'Pengeluaran'} · {formatCurrency(e.transaction.amount, e.transaction.currency)}
                        </p>
                      )}
                    </div>
                    <span className="mt-0.5 flex shrink-0 items-center gap-1.5">
                      {e.transaction?.category && <CategoryBadge name={e.transaction.category} size="sm" />}
                      <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium ${EMAIL_STATUS_STYLE[e.status] || EMAIL_STATUS_STYLE.fetched}`}>
                        {EMAIL_STATUS_LABEL[e.status] || e.status}
                      </span>
                    </span>
                  </div>
                ))}
              </Panel>
            )}
          </div>
        </>
      )}
    </div>
  );
}
