import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Plus } from 'lucide-react';
import BottomNav from '@/components/BottomNav';
import QuickAddDrawer from '@/features/spendly/components/QuickAddDrawer';
import { BOTTOM_NAV } from '@/config/navigation';
import { cn } from '@/lib/utils';
import { EASE_OUT } from '@/components/animate';

export default function MobileLayout() {
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const tab = BOTTOM_NAV.find((t) => pathname === t.path || (t.path === '/beranda' && pathname === '/'));

  // Judul inline ala iOS: muncul saat large title halaman ter-scroll.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [pathname]);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="relative mx-auto flex min-h-dvh max-w-md flex-col">
        {/* Nav bar ala iOS: transparan di atas, blur + judul inline setelah scroll */}
        <header
          className={cn(
            'sticky top-0 z-40 transition-colors',
            scrolled ? 'border-b border-border bg-white/80 backdrop-blur-xl dark:bg-black/70' : 'border-b border-transparent bg-transparent',
          )}
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          <div className="flex h-11 items-center justify-between px-4">
            <span className="w-11" aria-hidden="true" />
            <span
              className={cn(
                'text-[17px] font-semibold tracking-tight transition-opacity',
                scrolled ? 'opacity-100' : 'opacity-0',
              )}
            >
              {tab?.title || ''}
            </span>
            <button
              type="button"
              aria-label="Tambah pengeluaran"
              onClick={() => (pathname === '/transaksi' ? navigate('/transaksi?add=1') : setQuickAddOpen(true))}
              className="flex h-11 w-11 items-center justify-center rounded-full text-primary transition-transform active:scale-90"
            >
              <Plus className="h-6 w-6" strokeWidth={2} />
            </button>
          </div>
        </header>

        <AnimatePresence mode="wait" initial={false}>
          <motion.main
            key={pathname}
            id="main-content"
            className="flex-1 px-4 pb-6"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
          >
            <Outlet context={{ openQuickAdd: () => setQuickAddOpen(true) }} />
          </motion.main>
        </AnimatePresence>

        <BottomNav />
        <QuickAddDrawer open={quickAddOpen} onOpenChange={setQuickAddOpen} />
      </div>
    </div>
  );
}
