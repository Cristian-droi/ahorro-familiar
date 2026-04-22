import React, { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { X } from 'lucide-react';

interface RejectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  isLoading: boolean;
}

export function RejectionModal({
  isOpen,
  onClose,
  onConfirm,
  isLoading,
}: RejectionModalProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (!reason.trim()) {
      setError('Debes ingresar un motivo para el rechazo');
      return;
    }
    setError('');
    onConfirm(reason);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <Card
        padding="none"
        className="w-full max-w-lg shadow-lg-soft animate-in fade-in zoom-in-95 duration-200"
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-[var(--color-border)]">
          <h2 className="text-[17px] font-semibold tracking-tight text-[var(--color-text)]">
            Motivo de rechazo
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="w-8 h-8 flex items-center justify-center rounded-[8px] hover:bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] transition-colors"
          >
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-[var(--color-text-muted)] leading-[1.55]">
            Por favor, describe la razón por la cual esta solicitud no puede ser
            admitida. Esta información será enviada automáticamente por correo
            electrónico al usuario.
          </p>

          <div className="space-y-2">
            <textarea
              className={`w-full h-32 bg-[var(--color-surface)] border text-[var(--color-text)] placeholder-[var(--color-text-subtle)] rounded-[12px] p-3.5 text-sm resize-none transition-colors focus:outline-none focus:ring-4 ${
                error
                  ? 'border-[var(--color-danger)] ring-[var(--color-danger-soft)]'
                  : 'border-[var(--color-border)] focus:border-[var(--color-brand)] focus:ring-[var(--color-ring)]'
              }`}
              placeholder="Ej: No cumple con la edad mínima requerida, o los documentos son ilegibles..."
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (error) setError('');
              }}
            />
            {error && (
              <p className="text-[13px] text-[var(--color-danger)] font-medium pl-1">
                {error}
              </p>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-[var(--color-border)] bg-[var(--color-surface-alt)] flex items-center justify-end gap-2.5">
          <Button variant="secondary" onClick={onClose} disabled={isLoading}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={handleConfirm} disabled={isLoading}>
            {isLoading ? 'Rechazando...' : 'Confirmar rechazo'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
