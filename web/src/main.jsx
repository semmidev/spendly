import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { initTheme } from './lib/theme';
import App from './App';

initTheme();

// PWA: daftarkan service worker hanya di production agar dev tidak ke-cache.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// PWA: simpan event install agar tombol "Install aplikasi" bisa memicunya
// kapan saja (event hanya fire sekali bila kriteria Chrome terpenuhi).
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__spendlyInstall = e;
  window.dispatchEvent(new CustomEvent('spendly:installable'));
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
