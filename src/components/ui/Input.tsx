import React, { useState } from 'react';
import { LucideIcon, Eye, EyeOff } from 'lucide-react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: LucideIcon;
  label?: string;
  error?: string;
}

export function Input({
  icon: Icon,
  label,
  error,
  className = '',
  type,
  ...props
}: InputProps) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === 'password';
  const inputType = isPassword ? (showPassword ? 'text' : 'password') : type;

  return (
    <label className="flex flex-col gap-1.5 w-full">
      {label && (
        <span className="text-xs font-semibold text-[var(--color-text-muted)] tracking-tight">
          {label}
        </span>
      )}
      <div
        className={`relative flex items-center h-12 px-3.5 rounded-[12px] bg-[var(--color-surface)] border transition-colors focus-within:ring-2 focus-within:ring-[var(--color-brand)]/20 shadow-sm-soft ${
          error
            ? 'border-[var(--color-danger)] focus-within:border-[var(--color-danger)]'
            : 'border-[var(--color-border)] focus-within:border-[var(--color-brand)]'
        }`}
      >
        {Icon && (
          <Icon
            size={18}
            strokeWidth={1.75}
            className="mr-3 text-[var(--color-text-subtle)] shrink-0"
          />
        )}
        <input
          type={inputType}
          className={`flex-1 bg-transparent text-[15px] font-medium text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] tracking-tight focus:outline-none min-w-0 ${className}`}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            className="ml-2 text-[var(--color-text-subtle)] hover:text-[var(--color-text)] transition-colors shrink-0"
            aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        )}
      </div>
      {error && (
        <span className="text-xs font-medium text-[var(--color-danger)] pl-0.5">
          {error}
        </span>
      )}
    </label>
  );
}
