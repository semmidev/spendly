// Tema terang/gelap: class `dark` di <html>, persisten di localStorage,
// default mengikuti preferensi OS (ponytail: tanpa context/provider, cukup helper).
const KEY = 'spendly:theme';

export function getTheme() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch { /* abaikan */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try {
    localStorage.setItem(KEY, theme);
  } catch { /* abaikan */ }
}

export function initTheme() {
  applyTheme(getTheme());
}

export function toggleTheme() {
  const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
  applyTheme(next);
  return next;
}
