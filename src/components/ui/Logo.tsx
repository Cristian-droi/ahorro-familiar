import React from 'react';

interface LogoProps {
  size?: number;
  color?: string;
  className?: string;
}

/**
 * Logo de Ahorro Familiar — glifo minimal de moneda apilada.
 * Replica el "coin" del diseño original.
 */
export function Logo({ size = 24, color = 'currentColor', className = '' }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden
    >
      <rect x="4" y="10" width="24" height="14" rx="3" stroke={color} strokeWidth="2" />
      <rect x="8" y="6" width="16" height="6" rx="2" fill={color} />
      <circle cx="16" cy="17" r="3" stroke={color} strokeWidth="2" />
    </svg>
  );
}
