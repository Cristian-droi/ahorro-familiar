import React from 'react';

export type BadgeTone = 'brand' | 'success' | 'warn' | 'danger' | 'info' | 'neutral';

interface BadgeProps {
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}

const toneClasses: Record<BadgeTone, { bg: string; fg: string }> = {
  brand:   { bg: 'bg-[var(--color-brand-soft)]',   fg: 'text-[var(--color-brand)]' },
  success: { bg: 'bg-[var(--color-success-soft)]', fg: 'text-[var(--color-success)]' },
  warn:    { bg: 'bg-[var(--color-warn-soft)]',    fg: 'text-[var(--color-warn)]' },
  danger:  { bg: 'bg-[var(--color-danger-soft)]',  fg: 'text-[var(--color-danger)]' },
  info:    { bg: 'bg-[var(--color-info-soft)]',    fg: 'text-[var(--color-info)]' },
  neutral: { bg: 'bg-[var(--color-surface-alt)]',  fg: 'text-[var(--color-text-muted)]' },
};

const dotBgClasses: Record<BadgeTone, string> = {
  brand:   'bg-[var(--color-brand)]',
  success: 'bg-[var(--color-success)]',
  warn:    'bg-[var(--color-warn)]',
  danger:  'bg-[var(--color-danger)]',
  info:    'bg-[var(--color-info)]',
  neutral: 'bg-[var(--color-text-muted)]',
};

export function Badge({ tone = 'brand', dot = false, className = '', children }: BadgeProps) {
  const { bg, fg } = toneClasses[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-[3px] rounded-full text-[11px] font-semibold tracking-[0.01em] ${bg} ${fg} ${className}`}
    >
      {dot && (
        <span className={`w-1.5 h-1.5 rounded-full ${dotBgClasses[tone]}`} aria-hidden />
      )}
      {children}
    </span>
  );
}
