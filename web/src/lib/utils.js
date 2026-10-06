import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

const EMPTY_PLACEHOLDER = '-';

// formatDate renders a date+time in Indonesian locale (e.g. "25 Sep 2026, 14.30").
export function formatDate(dateString) {
  if (!dateString) return EMPTY_PLACEHOLDER;
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return EMPTY_PLACEHOLDER;
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

// formatCurrency renders an amount as Indonesian Rupiah (or the given currency).
export function formatCurrency(amount, currency = 'IDR') {
  if (amount === undefined || amount === null) return EMPTY_PLACEHOLDER;
  try {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

// Sapaan berdasarkan jam lokal: pagi ☀️ / siang 🌤️ / sore 🌇 / malam 🌙.
export function getGreeting(date = new Date()) {
  const h = date.getHours();
  if (h >= 5 && h < 11) return 'Selamat pagi ☀️';
  if (h >= 11 && h < 15) return 'Selamat siang 🌤️';
  if (h >= 15 && h < 18) return 'Selamat sore 🌇';
  return 'Selamat malam 🌙';
}

export function formatNumber(num) {
  if (num === undefined || num === null) return '0';
  return new Intl.NumberFormat('id-ID').format(num);
}
