import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import BottomNav from '@/components/BottomNav';
import QuickAddDrawer from '@/features/spendly/components/QuickAddDrawer';
import { EASE_OUT } from '@/components/animate';

export default function MobileLayout() {
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const { pathname } = useLocation();

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="relative mx-auto flex min-h-dvh max-w-md flex-col">
        {/* Nav sticky ikut alur di bawah: tidak perlu ruang kosong cadangan. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.main
            key={pathname}
            id="main-content"
            className="flex-1 px-4 pb-6 pt-6"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
          >
            <Outlet context={{ openQuickAdd: () => setQuickAddOpen(true) }} />
          </motion.main>
        </AnimatePresence>

        <BottomNav onFab={() => setQuickAddOpen(true)} />
        <QuickAddDrawer open={quickAddOpen} onOpenChange={setQuickAddOpen} />
      </div>
    </div>
  );
}
