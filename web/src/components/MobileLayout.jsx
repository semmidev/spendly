import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import BottomNav from '@/components/BottomNav';
import QuickAddDrawer from '@/features/spendly/components/QuickAddDrawer';

export default function MobileLayout() {
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="relative mx-auto flex min-h-dvh max-w-md flex-col">
        <main id="main-content" className="flex-1 px-4 pb-28 pt-6">
          <Outlet context={{ openQuickAdd: () => setQuickAddOpen(true) }} />
        </main>

        <BottomNav onFab={() => setQuickAddOpen(true)} />
        <QuickAddDrawer open={quickAddOpen} onOpenChange={setQuickAddOpen} />
      </div>
    </div>
  );
}
