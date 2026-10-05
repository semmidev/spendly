import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { BOTTOM_NAV } from '@/config/navigation';
import { resolveIcon } from '@/lib/iconResolver';
import { cn } from '@/lib/utils';

export default function BottomNav({ onFab }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  return (
    <nav
      aria-label="Navigasi utama"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-paper-white/95 backdrop-blur-md"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto grid max-w-md grid-cols-5 items-end px-3 pb-2 pt-1.5">
        {BOTTOM_NAV.map((item) => {
          if (item.isFab) {
            return (
              <div key={item.id} className="flex flex-col items-center gap-1">
                <button
                  type="button"
                  aria-label="Tambah pengeluaran"
                  onClick={() => (onFab ? onFab() : navigate('/transaksi?add=1'))}
                  className="flex h-8 w-12 items-center justify-center rounded-full bg-forest-ink text-white transition-transform active:scale-95 cursor-pointer"
                >
                  <Plus className="h-5 w-5" strokeWidth={2.2} />
                </button>
                <span className="text-[10px] font-medium invisible" aria-hidden="true">Tambah</span>
              </div>
            );
          }
          const active = pathname === item.path || (item.path === '/beranda' && pathname === '/');
          return (
            <NavLink key={item.id} to={item.path} className="flex flex-col items-center gap-1 py-1">
              <span
                className={cn(
                  'flex h-8 w-12 items-center justify-center rounded-full transition-colors',
                  active ? 'bg-meadow text-forest-ink' : 'text-lichen',
                )}
              >
                {resolveIcon(item.icon, { className: 'h-5 w-5', strokeWidth: active ? 2.2 : 1.8 })}
              </span>
              <span className={cn('text-[10px] font-medium', active ? 'text-forest-ink' : 'text-lichen')}>
                {item.title}
              </span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
