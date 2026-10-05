import { catMeta } from '@/features/spendly/categories';
import { cn } from '@/lib/utils';

// Kartu dasar ala Lattice: putih di atas perkamen, sudut 14px, bayangan lembut.
export function Panel({ className, children, ...props }) {
  return (
    <div className={cn('rounded-lg border border-border/60 bg-card shadow-md', className)} {...props}>
      {children}
    </div>
  );
}

// Label kategori: pill + heading + deskripsi (ritme section Lattice).
export function SectionTitle({ children, action }) {
  return (
    <div className="mb-2 flex items-end justify-between px-0.5">
      <h2 className="eyebrow">{children}</h2>
      {action}
    </div>
  );
}

// Badge kategori: lingkaran pastel + ikon tinta.
export function CategoryBadge({ name, size = 'md' }) {
  const { soft, Icon } = catMeta(name);
  const box = size === 'sm' ? 'h-9 w-9' : 'h-11 w-11';
  const icon = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';
  return (
    <span
      className={cn('flex shrink-0 items-center justify-center rounded-full border border-forest-ink/10', box)}
      style={{ backgroundColor: soft, color: '#001f1f' }}
    >
      <Icon className={icon} strokeWidth={2} />
    </span>
  );
}

export function Chip({ active, className, children, ...props }) {
  return (
    <button
      type="button"
      className={cn(
        'shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors cursor-pointer',
        active
          ? 'border-forest-ink bg-forest-ink text-white'
          : 'border-border bg-card text-stone hover:text-forest-ink',
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
    <Panel className="flex flex-col items-center gap-2 border-edge bg-mint px-6 py-10 text-center">
      {Icon && (
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-forest-ink text-white">
          <Icon className="h-5 w-5" strokeWidth={2} />
        </span>
      )}
      <p className="font-heading text-[15px] font-medium text-forest-ink">{title}</p>
      {description && <p className="max-w-[17rem] text-xs leading-relaxed text-lichen">{description}</p>}
      {action}
    </Panel>
  );
}

// Pil perubahan vs periode sebelumnya.
export function DeltaPill({ value, suffix = '' }) {
  const up = value >= 0;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] font-medium',
        up ? 'border-plum/30 bg-petal text-plum' : 'border-deep-forest/30 bg-sage text-deep-forest',
      )}
    >
      {up ? '▲' : '▼'} {Math.abs(value).toLocaleString('id-ID')}
      {suffix}
    </span>
  );
}
