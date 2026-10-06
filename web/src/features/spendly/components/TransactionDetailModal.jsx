import { useEffect, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { formatCurrency, formatDate } from '@/lib/utils';
import { CategoryBadge } from '@/features/spendly/components/primitives';
import { updateTransaction } from '@/features/spendly/api';

// Modal detail transaksi: klik row → info lengkap + edit kategori/catatan + hapus.
export default function TransactionDetailModal({ tx, categories = [], onClose, onUpdated, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [cat, setCat] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEditing(false);
    setCat(tx?.category || '');
    setNote(tx?.note || '');
  }, [tx?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!tx) return null;

  const rows = [
    ['Nominal', formatCurrency(tx.amount, tx.currency)],
    ['Merchant', tx.merchant || '-'],
    ['Kategori', tx.category || '-'],
    ['Catatan', tx.note || '-'],
    ['Waktu', formatDate(tx.occurred_at)],
    ...(tx.payment_source ? [['Sumber dana', tx.payment_source]] : []),
    ...(tx.source ? [['Asal', tx.source === 'gmail' ? 'Gmail otomatis' : tx.source]] : []),
    ...(tx.status ? [['Status', tx.status]] : []),
    ...(tx.confidence != null ? [['Keyakinan AI', `${Math.round(tx.confidence * 100)}%`]] : []),
    ...(tx.email_subject ? [['Subjek email', tx.email_subject]] : []),
    ...(tx.email_sender ? [['Pengirim', tx.email_sender]] : []),
    ...(tx.email_received_at ? [['Email diterima', formatDate(tx.email_received_at)]] : []),
  ];

  async function save() {
    setSaving(true);
    try {
      await updateTransaction(tx.id, { category: cat, note });
      toast.success('Transaksi diperbarui');
      onUpdated?.({ ...tx, category: cat, note });
      setEditing(false);
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Gagal menyimpan');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open={!!tx} onOpenChange={(open) => { if (!open) onClose?.(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 max-h-[85dvh] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-xl transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0">
          <div className="flex items-start gap-3">
            <CategoryBadge name={tx.category} />
            <div className="min-w-0 flex-1">
              <Dialog.Title className="truncate font-heading text-base font-medium text-forest-ink">
                {tx.merchant || tx.category || 'Pengeluaran'}
              </Dialog.Title>
              <p className="tnum font-mono text-lg font-medium text-forest-ink">{formatCurrency(tx.amount, tx.currency)}</p>
            </div>
            <Dialog.Close aria-label="Tutup" className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-lichen hover:bg-mint">✕</Dialog.Close>
          </div>

          {!editing ? (
            <dl className="mt-4 space-y-2.5">
              {rows.map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-3 text-xs">
                  <dt className="shrink-0 text-lichen">{k}</dt>
                  <dd className="tnum min-w-0 truncate text-right font-medium text-forest-ink" title={String(v)}>{v}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="eyebrow mb-1 block">Kategori</span>
                <select value={cat} onChange={(e) => setCat(e.target.value)} className="h-10 w-full cursor-pointer appearance-none rounded-full border border-border bg-card px-3 text-xs font-medium text-forest-ink outline-none">
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                  {!categories.includes(cat) && cat && <option value={cat}>{cat}</option>}
                </select>
              </label>
              <label className="block">
                <span className="eyebrow mb-1 block">Catatan</span>
                <Input value={note} onValueChange={setNote} placeholder="Catatan…" className="h-10" />
              </label>
            </div>
          )}

          <div className="mt-5 flex gap-2">
            {!editing ? (
              <>
                <button type="button" onClick={() => setEditing(true)} className="h-10 flex-1 cursor-pointer rounded-full border border-border text-xs font-medium text-forest-ink hover:bg-mint">
                  Edit
                </button>
                <button type="button" onClick={() => onDelete?.(tx)} className="inline-flex h-10 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full bg-destructive text-xs font-medium text-white hover:bg-destructive/90">
                  <Trash2 className="h-3.5 w-3.5" /> Hapus
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => setEditing(false)} className="h-10 flex-1 cursor-pointer rounded-full border border-border text-xs font-medium text-lichen">
                  Batal
                </button>
                <button type="button" onClick={save} disabled={saving} className="h-10 flex-1 cursor-pointer rounded-full bg-forest-ink text-xs font-medium text-white disabled:opacity-60">
                  {saving ? 'Menyimpan…' : 'Simpan'}
                </button>
              </>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// Modal detail email yang diabaikan: subjek, pengirim, status + proses ulang.
export function EmailDetailModal({ email, onClose, onReprocess }) {
  if (!email) return null;

  const rows = [
    ['Subjek', email.subject || '(tanpa subjek)'],
    ['Pengirim', email.sender_domain || '-'],
    ['Diterima', formatDate(email.received_at)],
    ...(email.status ? [['Status', email.status]] : []),
    ...(email.reason ? [['Alasan', email.reason]] : []),
  ];

  return (
    <Dialog.Root open={!!email} onOpenChange={(open) => { if (!open) onClose?.(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 max-h-[85dvh] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-xl transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="truncate font-heading text-base font-medium text-forest-ink">
                {email.subject || 'Email diabaikan'}
              </Dialog.Title>
              <p className="tnum truncate font-mono text-xs text-lichen">{email.sender_domain || ''}</p>
            </div>
            <Dialog.Close aria-label="Tutup" className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-lichen hover:bg-mint">✕</Dialog.Close>
          </div>

          <dl className="mt-4 space-y-2.5">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3 text-xs">
                <dt className="shrink-0 text-lichen">{k}</dt>
                <dd className="tnum min-w-0 truncate text-right font-medium text-forest-ink" title={String(v)}>{v}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-5 flex gap-2">
            <Dialog.Close className="h-10 flex-1 cursor-pointer rounded-full border border-border text-xs font-medium text-lichen transition-colors hover:bg-mint">
              Tutup
            </Dialog.Close>
            <button
              type="button"
              onClick={() => onReprocess?.(email)}
              className="h-10 flex-1 cursor-pointer rounded-full bg-forest-ink text-xs font-medium text-white"
            >
              Proses ulang
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
