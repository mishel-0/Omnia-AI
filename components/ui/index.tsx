'use client';

import React from 'react';
import { cn } from '@/lib/utils';

/** Apple Health–style accent colors, used for IconBadge + status tints. */
export const ACCENT = {
  red: { bg: '#FF3B30', tint: 'rgba(255, 59, 48, 0.12)' },
  orange: { bg: '#FF9500', tint: 'rgba(255, 149, 0, 0.12)' },
  yellow: { bg: '#FFCC00', tint: 'rgba(255, 204, 0, 0.14)' },
  green: { bg: '#34C759', tint: 'rgba(52, 199, 89, 0.12)' },
  teal: { bg: '#30B0C7', tint: 'rgba(48, 176, 199, 0.12)' },
  blue: { bg: '#007AFF', tint: 'rgba(0, 122, 255, 0.12)' },
  indigo: { bg: '#5856D6', tint: 'rgba(88, 86, 214, 0.12)' },
  purple: { bg: '#AF52DE', tint: 'rgba(175, 82, 222, 0.12)' },
  pink: { bg: '#FF2D55', tint: 'rgba(255, 45, 85, 0.12)' },
  gray: { bg: '#8E8E93', tint: 'rgba(142, 142, 147, 0.12)' },
} as const;

export type Accent = keyof typeof ACCENT;

/** The Omnia brand mark — the actual app icon (heartbeat/pulse), used everywhere in the UI
 * so the in-app logo matches the dock/DMG/Finder icon exactly. */
export function BrandMark({ size = 40, className }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand-mark.png"
      alt="Omnia Pathology AI"
      className={cn('shrink-0 object-contain select-none', className)}
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
}

/** White, rounded, soft-shadow card — the base building block of the Apple Health look. */
export function Card({
  className,
  size = 'md',
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { size?: 'sm' | 'md' | 'lg' }) {
  const radius = size === 'lg' ? 'rounded-[28px]' : size === 'sm' ? 'rounded-[16px]' : 'rounded-[20px]';
  return (
    <div
      className={cn('health-card theme-transition', radius, className)}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Colored squircle icon badge, e.g. the little colored icon next to each Health category. */
export function IconBadge({
  icon: Icon,
  accent = 'blue',
  size = 32,
  className,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  accent?: Accent;
  size?: number;
  className?: string;
}) {
  const c = ACCENT[accent];
  return (
    <div
      className={cn('flex items-center justify-center shrink-0 rounded-[10px]', className)}
      style={{ width: size, height: size, background: c.bg }}
    >
      <Icon className="text-white" style={{ width: size * 0.56, height: size * 0.56 } as React.CSSProperties} />
    </div>
  );
}

/** Soft-tinted icon badge (icon in accent color, tinted background) — used for secondary/inline icons. */
export function TintBadge({
  icon: Icon,
  accent = 'blue',
  size = 32,
  className,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  accent?: Accent;
  size?: number;
  className?: string;
}) {
  const c = ACCENT[accent];
  return (
    <div
      className={cn('flex items-center justify-center shrink-0 rounded-full', className)}
      style={{ width: size, height: size, background: c.tint }}
    >
      <Icon style={{ width: size * 0.52, height: size * 0.52, color: c.bg } as React.CSSProperties} />
    </div>
  );
}

/** Big bold number + label — the "highlight" stat tile pattern used throughout Apple Health. */
export function StatTile({
  label,
  value,
  accent,
  className,
}: {
  label: string;
  value: React.ReactNode;
  accent?: Accent;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      <span className="text-[12px] font-medium text-[var(--text-secondary)]">{label}</span>
      <span
        className="text-[22px] font-bold tracking-[-0.3px]"
        style={{ color: accent ? ACCENT[accent].bg : 'var(--text-primary)' }}
      >
        {value}
      </span>
    </div>
  );
}

/** Uppercase gray section label, e.g. "TRIALS", "SYSTEM STATUS". */
export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('health-section-header', className)}>{children}</div>;
}

/** Status pill, e.g. active / pending / confirmed. */
export function Pill({
  children,
  accent = 'gray',
  className,
}: {
  children: React.ReactNode;
  accent?: Accent;
  className?: string;
}) {
  const c = ACCENT[accent];
  return (
    <span
      className={cn('health-pill', className)}
      style={{ background: c.tint, color: c.bg }}
    >
      {children}
    </span>
  );
}

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 font-semibold transition-all active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none';

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizes = {
    sm: 'text-[13px] px-3.5 py-2 rounded-[10px]',
    md: 'text-[14px] px-5 py-3 rounded-[12px]',
    lg: 'text-[16px] px-6 py-3.5 rounded-[14px]',
  };
  const variants = {
    primary: 'bg-[#007AFF] hover:bg-[#0066CC] text-white shadow-sm shadow-[#007AFF]/20',
    secondary: 'bg-[var(--skeleton-bg)] hover:bg-[var(--border-medium)] text-[var(--text-primary)]',
    danger: 'bg-[#FF3B30]/10 hover:bg-[#FF3B30]/15 text-[#FF3B30]',
    ghost: 'bg-transparent hover:bg-[var(--skeleton-bg)] text-[var(--text-secondary)]',
  };
  return (
    <button className={cn(BUTTON_BASE, sizes[size], variants[variant], className)} {...rest}>
      {children}
    </button>
  );
}

/** Shimmering placeholder block for content that's still loading. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton-shimmer rounded-[6px]', className)} />;
}

/** Skeleton rows shaped like a data table, shown while the real rows load. */
export function TableSkeleton({ rows = 5, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="divide-y divide-[var(--border-subtle)]">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-6 px-4 py-3.5">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className={c === 0 ? 'h-3.5 flex-[2]' : 'h-3.5 flex-1'} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Centered empty-state block, e.g. "No trials yet." */
export function EmptyState({
  icon: Icon,
  title,
  subtitle,
  action,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-20 px-6">
      <div className="w-[64px] h-[64px] rounded-[18px] bg-[var(--skeleton-bg)] flex items-center justify-center mb-5">
        <Icon className="w-[28px] h-[28px] text-[var(--text-secondary)]" />
      </div>
      <h3 className="text-[17px] font-bold text-[var(--text-primary)] mb-1">{title}</h3>
      {subtitle && <p className="text-[14px] text-[var(--text-secondary)] mb-6 max-w-[320px]">{subtitle}</p>}
      {action}
    </div>
  );
}
