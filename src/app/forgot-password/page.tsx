'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Logo } from '@/components/ui/Logo';
import {
  IdCard,
  ArrowRight,
  ShieldCheck,
  MailCheck,
  ArrowLeft,
} from 'lucide-react';

// Pantalla pública para solicitar un nuevo enlace de creación/restablecimiento
// de contraseña.
//
// Diseño defensivo: el endpoint no distingue "documento válido" de "inválido"
// en la respuesta (evita enumeración). Por tanto, una vez enviado el form,
// siempre mostramos la misma pantalla de confirmación.

export default function ForgotPasswordPage() {
  const [document, setDocument] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<{ document?: string; submit?: string }>({});

  const validate = () => {
    const newErrors: typeof errors = {};
    if (!document.trim()) newErrors.document = 'El número de documento es obligatorio';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    setErrors({});

    try {
      const res = await fetch('/api/password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identityDocument: document }),
      });

      // Si Zod rechazó (formato del doc), le avisamos; cualquier otro caso
      // (existe / no existe) cae en el mismo estado de "enviado".
      if (res.status === 400) {
        const body = await res.json().catch(() => null);
        const docError =
          body?.details?.fieldErrors?.identityDocument?.[0] ??
          'Revisa el número de documento';
        setErrors({ document: docError });
        return;
      }

      setSubmitted(true);
    } catch (err) {
      console.error('Error al solicitar recovery:', err);
      setErrors({ submit: 'No pudimos procesar tu solicitud. Intenta de nuevo.' });
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen w-full bg-[var(--color-bg)]">
        <div className="h-16 px-6 sm:px-10 flex items-center justify-between border-b border-[var(--color-border)]">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-[30px] h-[30px] rounded-[8px] bg-[var(--color-brand)] flex items-center justify-center text-white dark:text-[var(--color-brand-ink)]">
              <Logo size={18} color="currentColor" />
            </div>
            <span className="text-sm font-semibold tracking-tight">Ahorro Familiar</span>
          </Link>
        </div>

        <div className="max-w-[460px] mx-auto px-6 py-16">
          <Card padding="lg" className="p-7 flex flex-col items-center text-center gap-4">
            <div className="w-14 h-14 rounded-full bg-[var(--color-success-soft)] text-[var(--color-success)] flex items-center justify-center">
              <MailCheck size={26} strokeWidth={1.75} />
            </div>
            <h1 className="text-[22px] font-semibold tracking-[-0.02em] leading-[1.2]">
              Revisa tu correo
            </h1>
            <p className="text-sm text-[var(--color-text-muted)] leading-[1.55]">
              Si el documento está registrado en Ahorro Familiar, te enviamos
              un enlace para crear una nueva contraseña. El correo puede tardar
              unos minutos en llegar; revisa también tu carpeta de spam.
            </p>
            <Link href="/login" className="w-full pt-2">
              <Button size="lg" variant="secondary" className="w-full">
                <ArrowLeft size={15} strokeWidth={1.75} />
                Volver a iniciar sesión
              </Button>
            </Link>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-[var(--color-bg)]">
      <div className="h-16 px-6 sm:px-10 flex items-center justify-between border-b border-[var(--color-border)]">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-[30px] h-[30px] rounded-[8px] bg-[var(--color-brand)] flex items-center justify-center text-white dark:text-[var(--color-brand-ink)]">
            <Logo size={18} color="currentColor" />
          </div>
          <span className="text-sm font-semibold tracking-tight">Ahorro Familiar</span>
        </Link>
      </div>

      <div className="max-w-[420px] mx-auto px-6 py-16">
        <div className="text-[11px] font-semibold text-[var(--color-brand)] tracking-[0.14em] uppercase mb-3">
          Recuperar acceso
        </div>
        <h1 className="text-[28px] font-semibold tracking-[-0.025em] leading-[1.15] mb-2">
          ¿Olvidaste tu contraseña?
        </h1>
        <p className="text-sm text-[var(--color-text-muted)] mb-8">
          Ingresa tu número de documento y te enviaremos un enlace al correo
          registrado para crear una nueva.
        </p>

        <Card padding="lg" className="p-7">
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {errors.submit && (
              <div className="p-3.5 rounded-[10px] bg-[var(--color-danger-soft)] text-[var(--color-danger)] text-sm font-medium">
                {errors.submit}
              </div>
            )}

            <Input
              label="Documento de identidad"
              icon={IdCard}
              type="text"
              placeholder="1 023 884 712"
              value={document}
              onChange={(e) => {
                setDocument(e.target.value);
                if (errors.document) setErrors({ ...errors, document: undefined });
              }}
              error={errors.document}
            />

            <Button type="submit" size="lg" className="w-full mt-2" disabled={loading}>
              {loading ? 'Enviando...' : 'Enviar enlace'}
              {!loading && <ArrowRight size={15} strokeWidth={1.75} />}
            </Button>

            <div className="pt-2 flex items-center justify-center gap-2 text-[11px] font-semibold text-[var(--color-text-subtle)] tracking-[0.14em] uppercase">
              <ShieldCheck size={13} strokeWidth={1.75} />
              <span>Enlace personal de un solo uso</span>
            </div>
          </form>
        </Card>

        <div className="mt-8 text-sm text-[var(--color-text-muted)] text-center">
          <Link
            href="/login"
            className="text-[var(--color-brand)] font-semibold hover:underline"
          >
            ← Volver a iniciar sesión
          </Link>
        </div>
      </div>
    </div>
  );
}
