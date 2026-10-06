import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { subscribeLoading } from '@/lib/client';
import { cn } from '@/lib/utils';

// Popup loading imut pengganti garis progres: backdrop blur + kartu kecil
// + tiga titik memantul. Non-blocking (pointer-events-none) agar halaman
// tetap bisa disentuh. Muncul hanya bila loading > 250ms supaya request
// cepat tidak bikin kedip.
const SHOW_DELAY = 250;

export default function TopLoadingBar() {
  const location = useLocation();
  const [visible, setVisible] = useState(false);
  const timerRef = useRef(null);

  function hide() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
  }

  function scheduleShow() {
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setVisible(true);
    }, SHOW_DELAY);
  }

  // Ganti halaman → sembunyikan (halaman baru punya skeleton-nya sendiri;
  // fetch halaman yang lambat akan memicu popup via aktivitas API).
  useEffect(() => {
    hide();
  }, [location.pathname, location.search]);

  // Aktivitas API global.
  useEffect(() => {
    const unsubscribe = subscribeLoading((isLoading) => {
      if (isLoading) scheduleShow();
      else hide();
    });
    return () => {
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div
      className={cn(
        'pointer-events-none fixed inset-0 z-[99999] flex items-center justify-center bg-forest-ink/10 backdrop-blur-[2px] transition-opacity duration-200',
        visible ? 'opacity-100' : 'opacity-0',
      )}
      aria-hidden="true"
    >
      <div
        className={cn(
          'flex items-center gap-3 rounded-2xl border border-border bg-card px-5 py-4 shadow-xl transition-all duration-200',
          visible ? 'scale-100' : 'scale-95',
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
