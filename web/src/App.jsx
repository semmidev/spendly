import React, { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { Toaster } from 'sonner';
import { useAuthStore } from '@/features/auth/store';
import { Skeleton } from '@/components/ui/skeleton';
import MobileLayout from '@/components/MobileLayout';

import Login from '@/features/auth/pages/Login';
import Landing from '@/features/landing/Landing';

const BerandaPage = lazy(() => import('@/features/spendly/pages/BerandaPage'));
const TransaksiPage = lazy(() => import('@/features/spendly/pages/TransaksiPage'));
const LaporanPage = lazy(() => import('@/features/spendly/pages/LaporanPage'));
const AkunPage = lazy(() => import('@/features/spendly/pages/AkunPage'));
const SyncDetailPage = lazy(() => import('@/features/spendly/pages/SyncDetailPage'));
const Privacy = lazy(() => import('@/features/legal/Privacy'));
const Terms = lazy(() => import('@/features/legal/Terms'));

// Skeleton ringan non-blocking untuk boot auth / lazy route pertama.
function BootSkeleton() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col space-y-6 px-4 pt-6 pb-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-40" />
          </div>
          <Skeleton className="h-10 w-10 rounded-full" />
        </div>
        <Skeleton className="h-36 w-full rounded-2xl" />
        <div className="space-y-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

function RouteFallback() {
  return <BootSkeleton />;
}

function PrivateRoute({ children }) {
  const { isAuthenticated, isLoading } = useAuthStore();
  if (isLoading) {
    return <BootSkeleton />;
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}

function PublicRoute({ children }) {
  const { isAuthenticated, isLoading } = useAuthStore();
  if (isLoading) {
    return <BootSkeleton />;
  }
  if (isAuthenticated) return <Navigate to="/beranda" replace />;
  return children;
}

export default function App() {
  const initialize = useAuthStore((state) => state.initialize);

  useEffect(() => {
    initialize();
  }, [initialize]);

  return (
    <MotionConfig reducedMotion="user">
      <Toaster
        position="bottom-center"
        closeButton={false}
        toastOptions={{
          style: {
            background: 'rgb(20 20 22 / 0.85)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            color: '#fff',
            border: 'none',
            borderRadius: '10px',
            fontSize: '13px',
            padding: '10px 14px',
          },
        }}
      />
      <Router>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<PublicRoute><Landing /></PublicRoute>} />
            <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            <Route element={<PrivateRoute><MobileLayout /></PrivateRoute>}>
              <Route path="/beranda" element={<BerandaPage />} />
              <Route path="/transaksi" element={<TransaksiPage />} />
              <Route path="/laporan" element={<LaporanPage />} />
              <Route path="/akun" element={<AkunPage />} />
              <Route path="/akun/sync/:id" element={<SyncDetailPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/beranda" replace />} />
          </Routes>
        </Suspense>
      </Router>
    </MotionConfig>
  );
}
