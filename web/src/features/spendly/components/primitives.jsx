import { catMeta } from '@/features/spendly/categories';
import { cn } from '@/lib/utils';

// Kartu grouped ala iOS: tanpa border luar, hanya separator antar-row.
export function Panel({ className, children, ...props }) {
  return (
    <div className={cn('overflow-hidden rounded-xl bg-card', className)} {...props}>
      {children}
    </div>
  );
}

// Header section ala iOS Health: judul 20px semibold.
export function SectionTitle({ children, action }) {
  return (
    <div className="mb-1.5 flex items-end justify-between px-4">
      <h2 className="text-[20px] font-bold tracking-tight text-foreground">{children}</h2>
      {action}
    </div>
  );
}

// Badge kategori: squircle iOS 10px + ikon.
export function CategoryBadge({ name, size = 'md' }) {
  const { soft, Icon } = catMeta(name);
  const box = size === 'sm' ? 'h-9 w-9 rounded-[10px]' : 'h-11 w-11 rounded-xl';
  const icon = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';
  return (
    <span
      className={cn('flex shrink-0 items-center justify-center', box)}
      style={{ backgroundColor: soft, color: 'var(--primary)' }}
    >
      <Icon className={icon} strokeWidth={2} />
    </span>
  );
}

// Segmented control iOS: wadah abu, pilihan aktif putih bershadow.
export function Segmented({ options, value, onChange, ariaLabel }) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex rounded-[10px] bg-secondary p-0.5"
    >
      {options.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(o.id)}
            className={cn(
              'flex h-8 flex-1 items-center justify-center gap-1 rounded-lg px-2 text-[13px] transition-all cursor-pointer',
              active ? 'bg-card font-semibold text-foreground shadow-sm' : 'font-normal text-muted-foreground',
            )}
          >
            {o.icon && <o.icon className="h-3.5 w-3.5" />}
            {o.title}
          </button>
        );
      })}
    </div>
  );
}

export function Chip({ active, className, children, ...props }) {
  return (
    <button
      type="button"
      className={cn(
        'shrink-0 rounded-full px-3.5 py-1.5 text-[13px] transition-colors cursor-pointer',
        active
          ? 'bg-primary font-semibold text-white'
          : 'bg-secondary font-normal text-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <Panel className="flex flex-col items-center gap-1.5 px-6 py-10 text-center">
      {Icon && (
        <span className="mb-1 flex h-14 w-14 items-center justify-center rounded-full bg-secondary text-muted-foreground">
          <Icon className="h-6 w-6" strokeWidth={1.6} />
        </span>
      )}
      <p className="text-[17px] font-semibold text-foreground">{title}</p>
      {description && <p className="max-w-[17rem] text-[13px] leading-relaxed text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </Panel>
  );
}

// Pil perubahan vs periode sebelumnya.
export function DeltaPill({ value, suffix = '' }) {
  const up = value >= 0;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[12px] font-medium',
        up ? 'bg-red-500/10 text-destructive' : 'bg-green-500/10 text-green-600 dark:text-green-400',
      )}
    >
      {up ? '▲' : '▼'} {Math.abs(value).toLocaleString('id-ID')}
      {suffix}
    </span>
  );
}

// Switch iOS.
export function Switch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-[31px] w-[51px] shrink-0 cursor-pointer rounded-full transition-colors',
        checked ? 'bg-[#34c759]' : 'bg-black/15 dark:bg-white/20',
      )}
    >
      <span
        className={cn(
          'absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow transition-all',
          checked ? 'left-[22px]' : 'left-[2px]',
        )}
      />
    </button>
  );
}
