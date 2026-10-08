import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { CategoryBadge } from '@/features/spendly/components/primitives';
import { uniqueCategories, DEFAULT_CATEGORIES } from '@/features/spendly/categories';
import { formatNumber } from '@/lib/utils';
import { createTransaction, getCategories } from '@/features/spendly/api';

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function QuickAddDrawer({ open, onOpenChange }) {
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('Makanan');
  const [merchant, setMerchant] = useState('');
  const [date, setDate] = useState(todayLocal());
  const [note, setNote] = useState('');
  const [cats, setCats] = useState(DEFAULT_CATEGORIES);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDate(todayLocal());
    getCategories()
      .then((d) => setCats(uniqueCategories(d?.items || [])))
      .catch(() => {});
  }, [open]);

  async function submit(e) {
    e?.preventDefault();
    const nominal = Number(String(amount).replace(/[^0-9]/g, ''));
    if (!nominal || nominal <= 0) {
      toast.error('Nominal harus lebih dari 0');
      return;
    }
    setSaving(true);
    try {
      const res = await createTransaction({ amount: nominal, currency: 'IDR', category, merchant, note, occurred_at: date });
      if (res?.possible_duplicate_of) {
        toast.warning('Tersimpan — ada transaksi mirip, cek di Transaksi');
      } else {
        toast.success('Pengeluaran tersimpan');
      }
      setAmount(''); setMerchant(''); setNote('');
      onOpenChange(false);
      window.dispatchEvent(new CustomEvent('spendly:refresh'));
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Gagal menyimpan');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-w-md rounded-t-[14px]">
        <div className="mx-auto mt-2 h-1.5 w-9 shrink-0 rounded-full bg-black/15 dark:bg-white/25" aria-hidden="true" />
        <DrawerHeader className="text-center">
          <DrawerTitle className="text-[17px] font-semibold text-foreground">Catat pengeluaran</DrawerTitle>
          <DrawerDescription className="text-[13px]">Isi nominal, pilih kategori, lalu simpan.</DrawerDescription>
        </DrawerHeader>

        <form onSubmit={submit} className="flex-1 space-y-4 overflow-y-auto px-4 pb-6 pt-3">
          {/* Nominal */}
          <div className="rounded-xl bg-secondary px-4 py-4 text-center">
            <div className="flex items-baseline justify-center gap-1">
              <span className="text-[17px] text-muted-foreground">Rp</span>
              <input
                inputMode="numeric"
                autoFocus
                value={amount ? formatNumber(Number(amount)) : ''}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="0"
                aria-label="Nominal"
                className="tnum w-full min-w-0 bg-transparent text-center text-[34px] font-bold tracking-tight text-foreground outline-none placeholder:text-muted-foreground/50"
              />
            </div>
          </div>

          {/* Kategori */}
          <div>
            <p className="mb-1.5 px-4 text-[13px] text-muted-foreground">Kategori</p>
            <div className="grid grid-cols-4 gap-2">
              {cats.map((c) => {
                const active = category === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    aria-pressed={active}
                    className={`flex flex-col items-center gap-1.5 rounded-xl px-1 py-2.5 transition-all cursor-pointer active:scale-95 ${
                      active ? 'bg-primary/10 ring-2 ring-primary' : 'bg-secondary'
                    }`}
                  >
                    <CategoryBadge name={c} size="sm" />
                    <span className={`w-full truncate text-center text-[11px] ${active ? 'font-semibold text-primary' : 'text-muted-foreground'}`}>
                      {c}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Detail */}
          <div className="space-y-2">
            <Input
              value={merchant}
              onValueChange={setMerchant}
              placeholder="Merchant (opsional)"
              aria-label="Merchant"
              className="h-11"
            />
            <Input
              type="date"
              value={date}
              onValueChange={setDate}
              aria-label="Tanggal"
              className="h-11"
            />
            <Input
              value={note}
              onValueChange={setNote}
              placeholder="Catatan (opsional)"
              aria-label="Catatan"
              className="h-11"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="inline-flex h-[50px] w-full items-center justify-center rounded-xl bg-primary text-[17px] font-semibold text-white disabled:opacity-50 cursor-pointer active:scale-[0.99]"
          >
            {saving ? 'Menyimpan…' : 'Simpan'}
          </button>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
