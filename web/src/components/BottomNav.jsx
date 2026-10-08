import { NavLink, useLocation } from 'react-router-dom';
import { BOTTOM_NAV } from '@/config/navigation';
import { resolveIcon } from '@/lib/iconResolver';
import { cn } from '@/lib/utils';

export default function BottomNav() {
  const { pathname } = useLocation();

  return (
    <nav
      aria-label="Navigasi utama"
      className="sticky bottom-0 z-50 border-t border-border bg-white/80 backdrop-blur-xl dark:bg-black/70"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto grid max-w-md grid-cols-4 px-2 pt-1.5 pb-2">
        {BOTTOM_NAV.map((item) => {
          const active = pathname === item.path || (item.path === '/beranda' && pathname === '/');
          return (
            <NavLink key={item.id} to={item.path} className="flex flex-col items-center gap-0.5 py-1">
              <span className={cn(active ? 'text-primary' : 'text-muted-foreground')}>
                {resolveIcon(item.icon, { className: 'h-6 w-6', strokeWidth: active ? 2 : 1.6 })}
              </span>
              <span className={cn('text-[10px]', active ? 'font-semibold text-primary' : 'font-normal text-muted-foreground')}>
                {item.title}
              </span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
