import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const paddingClasses = {
  none: '',
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
};

export function Card({
  children,
  className = '',
  padding = 'md',
  ...props
}: CardProps) {
  return (
    <div
      className={`bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[14px] ${paddingClasses[padding]} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
