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
      <DrawerContent className="mx-auto max-w-md">
        <DrawerHeader>
          <p className="eyebrow">Entri baru</p>
          <DrawerTitle className="font-heading text-lg font-medium text-forest-ink">Catat pengeluaran</DrawerTitle>
          <DrawerDescription>Isi nominal, pilih kategori, lalu simpan.</DrawerDescription>
        </DrawerHeader>

        <form onSubmit={submit} className="flex-1 space-y-4 overflow-y-auto px-4 pb-6 pt-4">
          {/* Nominal */}
          <div className="flex items-center gap-2 rounded-2xl border border-forest-ink/15 bg-butter px-4 py-3">
            <span className="text-base font-medium text-forest-ink/70">Rp</span>
            <input
              inputMode="numeric"
              autoFocus
              value={amount ? formatNumber(Number(amount)) : ''}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="0"
              aria-label="Nominal"
              className="tnum min-w-0 flex-1 bg-transparent text-2xl font-medium text-forest-ink outline-none placeholder:text-forest-ink/30"
            />
          </div>

          {/* Kategori */}
          <div>
            <p className="eyebrow mb-2">Kategori</p>
            <div className="grid grid-cols-4 gap-2">
              {cats.map((c) => {
                const active = category === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    className={`flex flex-col items-center gap-1.5 rounded-lg border px-1 py-2.5 transition-colors cursor-pointer ${
                      active ? 'border-forest-ink bg-meadow/50' : 'border-border'
                    }`}
                  >
                    <CategoryBadge name={c} size="sm" />
                    <span className={`w-full truncate text-center text-[10px] font-medium ${active ? 'text-forest-ink' : 'text-lichen'}`}>
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
            className="inline-flex h-[52px] w-full items-center justify-center rounded-full bg-forest-ink text-[15px] font-medium text-white transition-colors hover:bg-forest-ink/90 disabled:opacity-60 cursor-pointer"
          >
            {saving ? 'Menyimpan…' : 'Simpan pengeluaran'}
          </button>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
