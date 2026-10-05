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

// Warna & ikon per kategori — taksonomi pastel ala Lattice.
// `soft` = latar pastel badge; `color` = aksen vivid (khusus data/bar).
export const CATEGORY_META = {
  Makanan: { color: '#a36a14', soft: '#fff3c2', Icon: Utensils },
  Transport: { color: '#2a4e1c', soft: '#e4f7f9', Icon: Car },
  Belanja: { color: '#7a2251', soft: '#fde5ff', Icon: ShoppingBag },
  Tagihan: { color: '#003d3d', soft: '#e1e1fa', Icon: ReceiptText },
  Hiburan: { color: '#652ea3', soft: '#eff5ce', Icon: Clapperboard },
  Kesehatan: { color: '#515c0b', soft: '#f8fbe7', Icon: HeartPulse },
  Transfer: { color: '#455252', soft: '#fcf2fe', Icon: ArrowLeftRight },
  Lainnya: { color: '#6a7878', soft: '#f7f6f2', Icon: Package },
};

export const DEFAULT_CATEGORIES = Object.keys(CATEGORY_META);

export function catMeta(name) {
  return CATEGORY_META[name] || { color: '#2a4e1c', soft: '#e4f7f9', Icon: Wallet };
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
