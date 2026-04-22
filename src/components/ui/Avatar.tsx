import React from 'react';

interface AvatarProps {
  name?: string | null;
  size?: number;
  className?: string;
}

export function Avatar({ name, size = 32, className = '' }: AvatarProps) {
  const initial = (name?.[0] ?? 'U').toUpperCase();
  return (
    <div
      className={`inline-flex items-center justify-center rounded-full bg-[var(--color-brand-soft)] text-[var(--color-brand)] font-semibold shrink-0 border border-[var(--color-border)] dark:border-transparent ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden
    >
      {initial}
    </div>
  );
}
