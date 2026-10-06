import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { subscribeLoading } from '@/lib/client';
import LoadingPopup from '@/components/LoadingPopup';

// Pengatur kapan popup loading tampil: aktivitas API global + ganti halaman.
// Visualnya di LoadingPopup (dipakai juga untuk loading awal) agar konsisten.
// Muncul hanya bila loading > 250ms supaya request cepat tidak bikin kedip.
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

  return <LoadingPopup show={visible} />;
}
