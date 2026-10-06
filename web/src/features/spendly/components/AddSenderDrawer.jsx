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
      <DrawerContent className="mx-auto max-w-md">
        <DrawerHeader>
          <p className="eyebrow">Email yang dibaca</p>
          <DrawerTitle className="font-heading text-lg font-medium text-forest-ink">Tambah pengirim</DrawerTitle>
          <DrawerDescription>Tambahkan domain pengirim yang boleh dibaca Spendly.</DrawerDescription>
        </DrawerHeader>

        <form onSubmit={submit} className="flex-1 space-y-4 overflow-y-auto px-4 pb-6 pt-4">
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-lichen">Kategori</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-11 w-full rounded-md border border-border bg-card px-3 text-sm text-forest-ink focus:outline-none focus:ring-1 focus:ring-forest-ink"
              >
                {SENDER_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-lichen">Domain pengirim</label>
              <Input
                value={domain}
                onValueChange={setDomain}
                placeholder="domain pengirim (mis. bca.co.id)"
                aria-label="Domain pengirim"
                autoFocus
                className="h-11 font-mono"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-lichen">Label (opsional)</label>
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
            className="inline-flex h-[52px] w-full items-center justify-center rounded-full bg-forest-ink text-[15px] font-medium text-white transition-colors hover:bg-forest-ink/90 disabled:opacity-60 cursor-pointer"
          >
            {saving ? 'Menyimpan…' : 'Tambah pengirim'}
          </button>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
