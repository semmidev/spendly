import { useEffect, useState } from 'react';
import { AlertDialog } from '@base-ui/react/alert-dialog';
import { Input } from '@/components/ui/input';

// Alert ala iOS: popup tengah rounded-14, aksi berdampingan dengan separator.
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
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <AlertDialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-[270px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[14px] bg-card text-center shadow-xl transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0">
          <div className="px-4 pt-5 pb-3">
            <AlertDialog.Title className="text-[17px] font-semibold text-foreground">{title}</AlertDialog.Title>
            {description && (
              <AlertDialog.Description className="mt-1 text-[13px] leading-snug text-muted-foreground">
                {description}
              </AlertDialog.Description>
            )}
          {needWord && (
            <label className="mt-3 block text-left">
              <span className="mb-1.5 block text-[13px] text-muted-foreground">
                Ketik <span className="tnum font-mono font-semibold text-foreground">{confirmWord}</span> untuk melanjutkan
              </span>
              <Input
                value={typed}
                onValueChange={setTyped}
                placeholder={confirmWord}
                autoComplete="off"
                aria-label={`Ketik ${confirmWord} untuk konfirmasi`}
                className="h-11"
              />
            </label>
          )}
          </div>
          <div className="flex border-t border-border">
            <AlertDialog.Close className="h-11 flex-1 text-[17px] font-normal text-primary transition-colors active:bg-secondary cursor-pointer">
              {cancelLabel}
            </AlertDialog.Close>
            <button
              type="button"
              onClick={onConfirm}
              disabled={!matched}
              className="h-11 flex-1 border-l border-border text-[17px] font-semibold text-destructive transition-colors active:bg-secondary disabled:opacity-40 cursor-pointer"
            >
              {confirmLabel}
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
