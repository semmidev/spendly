import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { subscribeLoading } from '@/lib/client';
import { cn } from '@/lib/utils';

// Garis loading ala YouTube di top bar: gradient forest→meadow + glow + shimmer.
// Muncul hanya bila loading > 250ms supaya request cepat tidak bikin kedip.
// Non-blocking (pointer-events-none), hormat reduced-motion via media query.
const SHOW_DELAY = 250;
const FINISH_MS = 350;
const BAR_GRADIENT = 'linear-gradient(90deg, var(--forest-ink), var(--deep-forest) 55%, var(--meadow))';

export default function TopLoadingBar() {
  const location = useLocation();
  const [visible, setVisible] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const timerRef = useRef(null);
  const finishRef = useRef(null);

  function scheduleShow() {
    if (timerRef.current || visible) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setFinishing(false);
      setVisible(true);
    }, SHOW_DELAY);
  }

  function finish() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!visible) return;
    // Sapu ke 100% lalu fade-out.
    setFinishing(true);
    if (finishRef.current) clearTimeout(finishRef.current);
    finishRef.current = setTimeout(() => {
      finishRef.current = null;
      setVisible(false);
      setFinishing(false);
    }, FINISH_MS);
  }

  // Ganti halaman → selesaikan (halaman baru punya skeleton-nya sendiri).
  useEffect(() => {
    finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search]);

  useEffect(() => {
    const unsubscribe = subscribeLoading((isLoading) => {
      if (isLoading) scheduleShow();
      else finish();
    });
    return () => {
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
      if (finishRef.current) clearTimeout(finishRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[99999] pt-[env(safe-area-inset-top)]"
      role="progressbar"
      aria-hidden="true"
    >
      <style>{`@keyframes spendly-topbar-slide{0%{left:-35%}100%{left:100%}}@keyframes spendly-topbar-glint{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}@media (prefers-reduced-motion:reduce){.spendly-topbar-bar,.spendly-topbar-glint{animation:none!important}.spendly-topbar-bar{left:0!important;right:0!important;width:auto!important}}`}</style>
      <div className={cn('relative h-[3px] w-full overflow-hidden transition-opacity duration-200', finishing ? 'opacity-0' : 'opacity-100')}>
        {/* Glow lembut di bawah garis */}
        <div className="absolute inset-x-0 top-0 h-[8px] bg-deep-forest/20 blur-[6px]" />
        {finishing ? (
          <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: BAR_GRADIENT, boxShadow: '0 0 12px 1px var(--deep-forest)' }} />
        ) : (
          <div
            className="spendly-topbar-bar absolute top-0 h-[3px] w-[35%] rounded-full"
            style={{
              background: BAR_GRADIENT,
              boxShadow: '0 0 12px 1px var(--deep-forest)',
              animation: 'spendly-topbar-slide 1.1s cubic-bezier(0.45, 0, 0.55, 1) infinite',
            }}
          >
            {/* Kilau shimmer menyapu */}
            <div className="absolute inset-0 overflow-hidden rounded-full">
              <div
                className="spendly-topbar-glint absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/70 to-transparent"
                style={{ animation: 'spendly-topbar-glint 1.1s ease-in-out infinite' }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
