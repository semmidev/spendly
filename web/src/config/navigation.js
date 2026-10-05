/**
 * Navigasi bawah mobile Spendly (source of truth bottom nav).
 * 4 tab + 1 aksi tengah (FAB Quick-add). Bahasa Indonesia.
 */
export const BOTTOM_NAV = [
  { id: 'beranda', title: 'Beranda', path: '/beranda', icon: 'Home' },
  { id: 'transaksi', title: 'Transaksi', path: '/transaksi', icon: 'Receipt' },
  { id: 'tambah', title: 'Tambah', path: '/tambah', icon: 'Plus', isFab: true },
  { id: 'laporan', title: 'Laporan', path: '/laporan', icon: 'ChartPie' },
  { id: 'akun', title: 'Akun', path: '/akun', icon: 'User' },
];
