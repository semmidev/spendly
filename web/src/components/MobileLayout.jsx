import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import BottomNav from '@/components/BottomNav';
import QuickAddDrawer from '@/features/spendly/components/QuickAddDrawer';
import { EASE_OUT } from '@/components/animate';

export default function MobileLayout() {
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const { pathname } = useLocation();
  // iOS: ganti tab = crossfade instan; drill-down (detail) = push dari kanan.
  const isDrill = pathname.startsWith('/akun/sync/');

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="relative mx-auto flex min-h-dvh max-w-md flex-col">
        <AnimatePresence mode="wait" initial={false}>
          <motion.main
            key={pathname}
            id="main-content"
            className="flex-1 px-4 pt-4 pb-6"
            style={{ paddingTop: 'calc(env(safe-area-inset-top) + 16px)' }}
            initial={isDrill ? { opacity: 0, x: 48 } : { opacity: 0 }}
            animate={{ opacity: 1, x: 0 }}
            exit={isDrill ? { opacity: 0, x: 24 } : { opacity: 0 }}
            transition={{ duration: isDrill ? 0.28 : 0.12, ease: EASE_OUT }}
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
