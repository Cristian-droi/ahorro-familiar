'use client';

import React from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
import { Check, Mail, ArrowLeft } from 'lucide-react';

export default function ConfirmacionPage() {
  return (
    <div className="min-h-screen w-full bg-[var(--color-bg)]">
      {/* Top bar */}
      <div className="h-16 px-6 sm:px-10 flex items-center justify-between border-b border-[var(--color-border)]">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-[30px] h-[30px] rounded-[8px] bg-[var(--color-brand)] flex items-center justify-center text-white dark:text-[var(--color-brand-ink)]">
            <Logo size={18} color="currentColor" />
          </div>
          <span className="text-sm font-semibold tracking-tight">Ahorro Familiar</span>
        </Link>
      </div>

      <div className="max-w-[540px] mx-auto px-6 py-16 flex flex-col items-center text-center">
        {/* Check mark */}
        <div className="w-20 h-20 rounded-full bg-[var(--color-brand-soft)] flex items-center justify-center mb-8">
          <div className="w-12 h-12 rounded-full bg-[var(--color-brand)] flex items-center justify-center text-white dark:text-[var(--color-brand-ink)]">
            <Check size={24} strokeWidth={2.5} />
          </div>
        </div>

        <div className="text-[11px] font-semibold text-[var(--color-brand)] tracking-[0.14em] uppercase mb-3">
          Solicitud recibida
        </div>
        <h1 className="text-[32px] font-semibold tracking-[-0.025em] leading-[1.15] mb-4">
          ¡Solicitud enviada!
        </h1>
        <p className="text-[15px] text-[var(--color-text-muted)] leading-[1.55] max-w-[420px] mb-10">
          Tu solicitud fue recibida. Un administrador la revisará y recibirás una
          respuesta por correo electrónico en los próximos días hábiles.
        </p>

        <Card padding="md" className="w-full flex items-start gap-3.5 text-left mb-8">
          <div className="w-10 h-10 rounded-[10px] bg-[var(--color-info-soft)] text-[var(--color-info)] flex items-center justify-center shrink-0">
            <Mail size={18} strokeWidth={1.75} />
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold tracking-tight mb-1">
              Revisa tu bandeja de entrada
            </div>
            <p className="text-xs text-[var(--color-text-muted)] leading-[1.55]">
              No olvides revisar la carpeta de spam o correos no deseados para asegurar
              que recibas nuestra notificación.
            </p>
          </div>
        </Card>

        <Link href="/login" className="w-full">
          <Button variant="secondary" size="lg" className="w-full">
            <ArrowLeft size={16} strokeWidth={1.75} />
            Volver al inicio
          </Button>
        </Link>
      </div>
    </div>
  );
}
