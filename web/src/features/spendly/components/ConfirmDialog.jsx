import { useEffect, useState } from 'react';
import { AlertDialog } from '@base-ui/react/alert-dialog';
import { Input } from '@/components/ui/input';

// Modal konfirmasi (mis. hapus). Pakai AlertDialog base-ui agar fokus terkunci
// dan tidak bisa ditutup sembarangan sebelum user memilih.
// confirmWord: bila diisi, user wajib mengetik kata tersebut (ala SaaS)
// sebelum tombol konfirmasi aktif — untuk aksi destruktif permanen.
export default function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Hapus',
  cancelLabel = 'Batal',
  confirmWord = '',
  onConfirm,
}) {
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (open) setTyped('');
  }, [open ]);

  const needWord = confirmWord.trim() !== '';
  const matched = !needWord || typed.trim().toLowerCase() === confirmWord.trim().toLowerCase();
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/40 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <AlertDialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-5 shadow-xl transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0">
          <AlertDialog.Title className="font-heading text-base font-medium text-forest-ink">{title}</AlertDialog.Title>
          {description && (
            <AlertDialog.Description className="mt-1.5 text-xs leading-relaxed text-lichen">
              {description}
            </AlertDialog.Description>
          )}
          {needWord && (
            <label className="mt-4 block">
              <span className="mb-1.5 block text-xs text-lichen">
                Ketik <span className="tnum font-mono font-medium text-forest-ink">{confirmWord}</span> untuk melanjutkan
              </span>
              <Input
                value={typed}
                onValueChange={setTyped}
                placeholder={confirmWord}
                autoComplete="off"
                aria-label={`Ketik ${confirmWord} untuk konfirmasi`}
                className="h-10"
              />
            </label>
          )}
          <div className="mt-5 flex gap-2">
            <AlertDialog.Close className="h-10 flex-1 rounded-full border border-border text-xs font-medium text-lichen transition-colors hover:bg-mint cursor-pointer">
              {cancelLabel}
            </AlertDialog.Close>
            <button
              type="button"
              onClick={onConfirm}
              disabled={!matched}
              className="h-10 flex-1 rounded-full bg-destructive text-xs font-medium text-white transition-colors hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
            >
              {confirmLabel}
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
