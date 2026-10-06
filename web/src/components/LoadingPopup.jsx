import { cn } from '@/lib/utils';

// Popup loading imut: backdrop blur + kartu kecil + tiga titik memantul,
// selalu di tengah layar. Dipakai loading awal (auth/lazy route) maupun
// loading navigasi/API agar konsisten.
export default function LoadingPopup({ show = true }) {
  return (
    <div
      className={cn(
        'pointer-events-none fixed inset-0 z-[99999] flex items-center justify-center bg-forest-ink/10 backdrop-blur-[2px] transition-opacity duration-200',
        show ? 'opacity-100' : 'opacity-0',
      )}
      aria-hidden="true"
    >
      <div
        className={cn(
          'flex items-center gap-3 rounded-2xl border border-border bg-card px-5 py-4 shadow-xl transition-all duration-200',
          show ? 'scale-100' : 'scale-95',
        )}
      >
        <span className="flex items-center gap-1.5" aria-hidden="true">
          <span className="h-2 w-2 animate-bounce rounded-full bg-forest-ink [animation-delay:-0.3s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-forest-ink [animation-delay:-0.15s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-forest-ink" />
        </span>
        <span className="text-xs font-medium text-lichen">Sebentar ya…</span>
      </div>
    </div>
  );
}
