import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { addSenderRegistry } from '@/features/spendly/api';

export const SENDER_CATEGORIES = [
  'Banks',
  'Digital Banks',
  'E-Wallet',
  'Payment / Fintech',
  'Marketplace',
  'Travel',
  'Lainnya',
];

export default function AddSenderDrawer({ open, onOpenChange, onAdded }) {
  const [domain, setDomain] = useState('');
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState('Banks');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDomain('');
    setLabel('');
    setCategory('Banks');
  }, [open]);

  async function submit(e) {
    e?.preventDefault();
    const d = domain.trim().toLowerCase();
    if (!d) {
      toast.error('Isi domain pengirim');
      return;
    }
    setSaving(true);
    try {
      await addSenderRegistry(d, label.trim(), category);
      toast.success('Pengirim ditambahkan');
      onOpenChange(false);
      onAdded?.();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Gagal menambah pengirim');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-w-md rounded-t-[14px]">
        <div className="mx-auto mt-2 h-1.5 w-9 shrink-0 rounded-full bg-black/15 dark:bg-white/25" aria-hidden="true" />
        <DrawerHeader className="text-center">
          <DrawerTitle className="text-[17px] font-semibold text-foreground">Tambah pengirim</DrawerTitle>
          <DrawerDescription className="text-[13px]">Domain pengirim yang boleh dibaca Spendly.</DrawerDescription>
        </DrawerHeader>

        <form onSubmit={submit} className="flex-1 space-y-4 overflow-y-auto px-4 pb-6 pt-3">
          <div className="space-y-3">
            <div>
              <label className="mb-1 block px-4 text-[13px] text-muted-foreground">Kategori</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-11 w-full rounded-[10px] bg-secondary px-3 text-[15px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                {SENDER_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block px-4 text-[13px] text-muted-foreground">Domain pengirim</label>
              <Input
                value={domain}
                onValueChange={setDomain}
                placeholder="mis. bca.co.id"
                aria-label="Domain pengirim"
                autoFocus
                className="h-11 font-mono"
              />
            </div>

            <div>
              <label className="mb-1 block px-4 text-[13px] text-muted-foreground">Label (opsional)</label>
              <Input
                value={label}
                onValueChange={setLabel}
                placeholder="Label (opsional)"
                aria-label="Label pengirim"
                className="h-11"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="inline-flex h-[50px] w-full items-center justify-center rounded-xl bg-primary text-[17px] font-semibold text-white disabled:opacity-50 cursor-pointer active:scale-[0.99]"
          >
            {saving ? 'Menyimpan…' : 'Tambah pengirim'}
          </button>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
