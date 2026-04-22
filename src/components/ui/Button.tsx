import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'outline' | 'tertiary';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: React.ReactNode;
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-2',
  md: 'h-9 px-3.5 text-[13px] gap-2',
  lg: 'h-11 px-[18px] text-sm gap-2',
};

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--color-brand)] text-white dark:text-[var(--color-brand-ink)] border border-transparent shadow-sm-soft hover:brightness-95 dark:hover:brightness-110 active:brightness-90',
  secondary:
    'bg-[var(--color-surface)] text-[var(--color-text)] border border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]',
  outline:
    'bg-transparent text-[var(--color-brand)] border border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]',
  ghost:
    'bg-transparent text-[var(--color-text-muted)] border border-transparent hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text)]',
  danger:
    'bg-[var(--color-danger-soft)] text-[var(--color-danger)] border border-transparent hover:brightness-95',
  success:
    'bg-[var(--color-success-soft)] text-[var(--color-success)] border border-transparent hover:brightness-95',
  // Alias legacy (tertiary == ghost pero con color de marca)
  tertiary:
    'bg-transparent text-[var(--color-brand)] border border-transparent hover:bg-[var(--color-brand-soft)]',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...props
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center font-semibold rounded-[9px] tracking-tight transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-bg)] focus-visible:ring-[var(--color-brand)]';

  return (
    <button
      className={`${base} ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
