import React, { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { useAuthStore } from '@/features/auth/store';
import TopLoadingBar from '@/components/TopLoadingBar';
import MobileLayout from '@/components/MobileLayout';

import Login from '@/features/auth/pages/Login';

const BerandaPage = lazy(() => import('@/features/spendly/pages/BerandaPage'));
const TransaksiPage = lazy(() => import('@/features/spendly/pages/TransaksiPage'));
const LaporanPage = lazy(() => import('@/features/spendly/pages/LaporanPage'));
const AkunPage = lazy(() => import('@/features/spendly/pages/AkunPage'));
const SyncDetailPage = lazy(() => import('@/features/spendly/pages/SyncDetailPage'));

function RouteFallback() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function PrivateRoute({ children }) {
  const { isAuthenticated, isLoading } = useAuthStore();
  if (isLoading) {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}

function PublicRoute({ children }) {
  const { isAuthenticated, isLoading } = useAuthStore();
  if (isLoading) {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
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
    <>
      <Toaster position="top-center" richColors closeButton />
      <Router>
        <TopLoadingBar />
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<Navigate to="/beranda" replace />} />
            <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
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
    </>
  );
}
