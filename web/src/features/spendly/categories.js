import {
  Utensils,
  Car,
  ShoppingBag,
  ReceiptText,
  Clapperboard,
  HeartPulse,
  ArrowLeftRight,
  Package,
  Wallet,
} from 'lucide-react';

// Warna & ikon per kategori — tint sistem iOS 12%.
// `soft` = latar badge; `color` = aksen vivid (khusus data/bar).
export const CATEGORY_META = {
  Makanan: { color: '#ff9f0a', soft: 'rgb(255 159 10 / 0.12)', Icon: Utensils },
  Transport: { color: '#007aff', soft: 'rgb(0 122 255 / 0.12)', Icon: Car },
  Belanja: { color: '#af52de', soft: 'rgb(175 82 222 / 0.12)', Icon: ShoppingBag },
  Tagihan: { color: '#5ac8fa', soft: 'rgb(90 200 250 / 0.12)', Icon: ReceiptText },
  Hiburan: { color: '#ff375f', soft: 'rgb(255 55 95 / 0.12)', Icon: Clapperboard },
  Kesehatan: { color: '#34c759', soft: 'rgb(52 199 89 / 0.12)', Icon: HeartPulse },
  Transfer: { color: '#8e8e93', soft: 'rgb(142 142 147 / 0.12)', Icon: ArrowLeftRight },
  Lainnya: { color: '#8e8e93', soft: 'rgb(142 142 147 / 0.12)', Icon: Package },
};

export const DEFAULT_CATEGORIES = Object.keys(CATEGORY_META);

export function catMeta(name) {
  return CATEGORY_META[name] || { color: '#007aff', soft: 'rgb(0 122 255 / 0.12)', Icon: Wallet };
}

// Buang duplikat & kosong, pertahankan urutan default lebih dulu.
export function uniqueCategories(list = []) {
  const seen = new Set();
  const out = [];
  for (const raw of [...DEFAULT_CATEGORIES, ...list]) {
    const name = typeof raw === 'string' ? raw : raw?.name;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}
