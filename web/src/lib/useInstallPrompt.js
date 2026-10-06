import { useCallback, useEffect, useState } from 'react';

// Instalasi PWA: event beforeinstallprompt hanya fire sekali (dan hanya di
// Chromium), jadi main.jsx menyimpannya di window; hook ini membaca +
// memicu prompt dari tombol "Install aplikasi" di halaman Akun.
export function useInstallPrompt() {
  const [ready, setReady] = useState(() => !!window.__spendlyInstall);
  const [installed, setInstalled] = useState(
    () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true,
  );

  useEffect(() => {
    const onAvail = () => setReady(!!window.__spendlyInstall);
    const onDone = () => {
      window.__spendlyInstall = null;
      setReady(false);
      setInstalled(true);
    };
    window.addEventListener('spendly:installable', onAvail);
    window.addEventListener('appinstalled', onDone);
    return () => {
      window.removeEventListener('spendly:installable', onAvail);
      window.removeEventListener('appinstalled', onDone);
    };
  }, []);

  const install = useCallback(async () => {
    const e = window.__spendlyInstall;
    if (!e) return false;
    e.prompt();
    let outcome = 'dismissed';
    try {
      ({ outcome } = await e.userChoice);
    } catch { /* abaikan */ }
    if (outcome === 'accepted') {
      window.__spendlyInstall = null;
      setReady(false);
      setInstalled(true);
    }
    return outcome === 'accepted';
  }, []);

  return { canInstall: ready && !installed, install };
}
