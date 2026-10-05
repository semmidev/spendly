import { AlertDialog } from '@base-ui/react/alert-dialog';

// Modal konfirmasi (mis. hapus). Pakai AlertDialog base-ui agar fokus terkunci
// dan tidak bisa ditutup sembarangan sebelum user memilih.
export default function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Hapus',
  cancelLabel = 'Batal',
  onConfirm,
}) {
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
          <div className="mt-5 flex gap-2">
            <AlertDialog.Close className="h-10 flex-1 rounded-full border border-border text-xs font-medium text-lichen transition-colors hover:bg-mint cursor-pointer">
              {cancelLabel}
            </AlertDialog.Close>
            <button
              type="button"
              onClick={onConfirm}
              className="h-10 flex-1 rounded-full bg-destructive text-xs font-medium text-white transition-colors hover:bg-destructive/90 cursor-pointer"
            >
              {confirmLabel}
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
