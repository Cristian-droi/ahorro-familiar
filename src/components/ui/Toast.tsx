'use client';

import React, { useState, useEffect } from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
}

const iconMap = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
};

const colorMap = {
  success: 'text-[var(--color-success)]',
  error: 'text-[var(--color-danger)]',
  info: 'text-[var(--color-info)]',
};

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const handleToast = (e: Event) => {
      const customEvent = e as CustomEvent<Omit<ToastMessage, 'id'>>;
      const id = Math.random().toString(36).slice(2, 11);
      setToasts((prev) => [...prev, { ...customEvent.detail, id }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 5000);
    };

    window.addEventListener('toast', handleToast);
    return () => window.removeEventListener('toast', handleToast);
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-3 max-w-sm pointer-events-none">
      {toasts.map((toast) => {
        const Icon = iconMap[toast.type];
        return (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-start gap-3 p-4 bg-[var(--color-surface)] rounded-[12px] shadow-lg-soft border border-[var(--color-border)] animate-in slide-in-from-right-8 fade-in duration-300"
          >
            <Icon
              className={`${colorMap[toast.type]} shrink-0 mt-0.5`}
              size={18}
              strokeWidth={1.75}
            />
            <div className="flex-1 min-w-[200px] pt-[1px]">
              <p className="text-[13px] font-semibold text-[var(--color-text)] leading-snug tracking-tight">
                {toast.message}
              </p>
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-[var(--color-text-subtle)] hover:text-[var(--color-text)] transition-colors shrink-0"
              aria-label="Cerrar notificación"
            >
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export const showToast = (type: ToastType, message: string) => {
  if (typeof window !== 'undefined') {
    const event = new CustomEvent('toast', { detail: { type, message } });
    window.dispatchEvent(event);
  }
};
