import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, MailOpen } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Panel, SectionTitle, CategoryBadge } from '@/features/spendly/components/primitives';
import { getSyncDetail } from '@/features/spendly/api';

const EMAIL_STATUS_STYLE = {
  parsed: 'text-green-600 dark:text-green-400',
  needs_review: 'text-orange-600 dark:text-orange-400',
  ignored: 'text-muted-foreground',
  gated_out: 'text-muted-foreground',
  dedup: 'text-muted-foreground',
  fetched: 'text-primary',
  extracting: 'text-primary',
  failed: 'text-destructive',
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
    <div className="space-y-4">
      <div className="flex items-center gap-1 pt-1">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Kembali"
          className="flex h-11 items-center gap-0.5 pr-2 text-[17px] text-primary cursor-pointer active:opacity-60"
        >
          <ChevronLeft className="h-6 w-6" />
          Riwayat
        </button>
      </div>
      <h1 className="-mt-1 text-[34px] leading-tight font-bold tracking-tight text-foreground">Detail sinkronisasi</h1>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-28 w-full rounded-xl bg-secondary" />
          <Skeleton className="h-16 w-full rounded-xl bg-secondary" />
          <Skeleton className="h-16 w-full rounded-xl bg-secondary" />
        </div>
      ) : !job ? (
        <Panel className="px-6 py-10 text-center">
          <p className="text-[17px] font-semibold text-foreground">Riwayat tidak ditemukan</p>
          <p className="mx-auto mt-1 max-w-[17rem] text-[13px] leading-relaxed text-muted-foreground">Mungkin sudah terhapus atau bukan milik akun ini.</p>
        </Panel>
      ) : (
        <>
          <Panel className="space-y-2.5 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] text-muted-foreground">{job.mode === 'backfill' ? 'Pindai penuh' : 'Inkremental'}</span>
              <span className="tnum text-[13px] text-muted-foreground">{durationMs(job.created_at, job.finished_at)}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                [job.new, 'baru'],
                [job.gated, 'diabaikan'],
                [job.extracted, 'diekstrak'],
              ].map(([v, label]) => (
                <div key={label} className="rounded-xl bg-secondary px-2 py-2.5">
                  <p className="tnum text-[17px] font-semibold text-foreground">{v ?? 0}</p>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
            <p className="tnum text-[13px] leading-relaxed text-muted-foreground">
              mulai {job.created_at ? formatDate(job.created_at) : '-'}
              {job.finished_at ? ` · selesai ${formatDate(job.finished_at)}` : ' · masih berjalan'}
              {job.message ? ` · ${job.message}` : ''}
            </p>
          </Panel>

          <div>
            <SectionTitle>Email diproses ({emails.length})</SectionTitle>
            {emails.length === 0 ? (
              <Panel className="px-6 py-10 text-center">
                <MailOpen className="mx-auto h-6 w-6 text-muted-foreground" />
                <p className="mt-2 text-[17px] font-semibold text-foreground">Tidak ada rincian email</p>
                <p className="mx-auto mt-1 max-w-[17rem] text-[13px] leading-relaxed text-muted-foreground">
                  Rincian per email hanya tersedia untuk sinkronisasi setelah pembaruan ini.
                </p>
              </Panel>
            ) : (
              <Panel className="divide-y divide-border/60">
                {emails.map((e, i) => (
                  <div key={`${e.received_at}-${i}`} className="flex items-start gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] text-foreground">{e.subject || '(tanpa subjek)'}</p>
                      <p className="tnum truncate text-[13px] text-muted-foreground">
                        {e.sender_domain || ''}
                        {e.received_at ? ` · ${formatDate(e.received_at)}` : ''}
                        {e.ignore_reason ? ` · ${e.ignore_reason}` : ''}
                        {e.confidence != null ? ` · ${Math.round(e.confidence * 100)}%` : ''}
                      </p>
                      {e.error && (
                        <p className="mt-1 break-words font-mono text-[13px] leading-relaxed text-destructive">log: {e.error}</p>
                      )}
                      {e.transaction && (
                        <p className="tnum mt-1 text-[15px] font-semibold text-foreground">
                          {e.transaction.merchant || e.transaction.category || 'Pengeluaran'} · {formatCurrency(e.transaction.amount, e.transaction.currency)}
                        </p>
                      )}
                    </div>
                    <span className="mt-0.5 flex shrink-0 items-center gap-1.5">
                      {e.transaction?.category && <CategoryBadge name={e.transaction.category} size="sm" />}
                      <span className={`text-[13px] ${EMAIL_STATUS_STYLE[e.status] || EMAIL_STATUS_STYLE.fetched}`}>
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
