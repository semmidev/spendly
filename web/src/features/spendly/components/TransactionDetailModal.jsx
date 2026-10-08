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
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 max-h-[85dvh] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[14px] bg-card p-5 shadow-xl transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0">
          <div className="flex items-center gap-3">
            <CategoryBadge name={tx.category} />
            <div className="min-w-0 flex-1">
              <Dialog.Title className="truncate text-[17px] font-semibold text-foreground">
                {tx.merchant || tx.category || 'Pengeluaran'}
              </Dialog.Title>
              <p className="tnum text-[15px] font-semibold text-foreground">{formatCurrency(tx.amount, tx.currency)}</p>
            </div>
            <Dialog.Close aria-label="Tutup" className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-secondary text-muted-foreground active:scale-95">✕</Dialog.Close>
          </div>

          {!editing ? (
            <dl className="mt-4 overflow-hidden rounded-xl bg-secondary">
              <div className="divide-y divide-border/60">
                {rows.map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-[15px]">
                    <dt className="shrink-0 text-muted-foreground">{k}</dt>
                    <dd className="tnum min-w-0 truncate text-right text-foreground" title={String(v)}>{v}</dd>
                  </div>
                ))}
              </div>
            </dl>
          ) : (
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="mb-1 block px-4 text-[13px] text-muted-foreground">Kategori</span>
                <select value={cat} onChange={(e) => setCat(e.target.value)} className="h-11 w-full cursor-pointer appearance-none rounded-[10px] bg-secondary px-3 text-[15px] text-foreground outline-none">
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                  {!categories.includes(cat) && cat && <option value={cat}>{cat}</option>}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block px-4 text-[13px] text-muted-foreground">Catatan</span>
                <Input value={note} onValueChange={setNote} placeholder="Catatan…" className="h-11" />
              </label>
            </div>
          )}

          <div className="mt-4 flex gap-2">
            {!editing ? (
              <>
                <button type="button" onClick={() => setEditing(true)} className="h-[44px] flex-1 cursor-pointer rounded-xl bg-secondary text-[15px] font-semibold text-primary active:scale-[0.98]">
                  Edit
                </button>
                <button type="button" onClick={() => onDelete?.(tx)} className="inline-flex h-[44px] flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-destructive text-[15px] font-semibold text-white active:scale-[0.98]">
                  <Trash2 className="h-4 w-4" /> Hapus
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => setEditing(false)} className="h-[44px] flex-1 cursor-pointer rounded-xl bg-secondary text-[15px] text-muted-foreground active:scale-[0.98]">
                  Batal
                </button>
                <button type="button" onClick={save} disabled={saving} className="h-[44px] flex-1 cursor-pointer rounded-xl bg-primary text-[15px] font-semibold text-white disabled:opacity-50 active:scale-[0.98]">
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
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 max-h-[85dvh] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[14px] bg-card p-5 shadow-xl transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="truncate text-[17px] font-semibold text-foreground">
                {email.subject || 'Email diabaikan'}
              </Dialog.Title>
              <p className="tnum truncate text-[13px] text-muted-foreground">{email.sender_domain || ''}</p>
            </div>
            <Dialog.Close aria-label="Tutup" className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-secondary text-muted-foreground active:scale-95">✕</Dialog.Close>
          </div>

          <dl className="mt-4 overflow-hidden rounded-xl bg-secondary">
            <div className="divide-y divide-border/60">
              {rows.map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-[15px]">
                  <dt className="shrink-0 text-muted-foreground">{k}</dt>
                  <dd className="tnum min-w-0 truncate text-right text-foreground" title={String(v)}>{v}</dd>
                </div>
              ))}
            </div>
          </dl>

          {email.error && (
            <div className="mt-3 rounded-xl bg-red-500/10 px-4 py-2.5">
              <p className="text-[13px] font-semibold text-destructive">Log error</p>
              <p className="mt-0.5 break-words font-mono text-[13px] leading-relaxed text-destructive">{email.error}</p>
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <Dialog.Close className="h-[44px] flex-1 cursor-pointer rounded-xl bg-secondary text-[15px] text-muted-foreground active:scale-[0.98]">
              Tutup
            </Dialog.Close>
            <button
              type="button"
              onClick={() => onReprocess?.(email)}
              className="h-[44px] flex-1 cursor-pointer rounded-xl bg-primary text-[15px] font-semibold text-white active:scale-[0.98]"
            >
              Proses ulang
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
