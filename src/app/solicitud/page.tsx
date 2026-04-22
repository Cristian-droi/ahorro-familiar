'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
import {
  User,
  Mail,
  DollarSign,
  MapPin,
  Phone,
  IdCard,
  ArrowRight,
  ShieldCheck,
  Clock,
  Users,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import {
  membershipRequestInput,
  toMembershipRequestRow,
} from '@/lib/schemas/membership-request';
import {
  createMembershipRequest,
  isDuplicateDocumentError,
} from '@/lib/data/membership-requests';

export default function SolicitudPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [globalError, setGlobalError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    address: '',
    identityDocument: '',
    monthlyIncome: '',
  });

  const formatPhone = (val: string) => {
    const digits = val.replace(/\D/g, '').substring(0, 10);
    if (digits.length > 6) return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
    if (digits.length > 3) return `${digits.slice(0, 3)} ${digits.slice(3)}`;
    return digits;
  };

  const formatMoney = (val: string) => {
    const digits = val.replace(/\D/g, '');
    if (!digits) return '';
    return new Intl.NumberFormat('es-CO').format(parseInt(digits, 10));
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    let newValue = value;

    if (name === 'phone') newValue = formatPhone(value);
    if (name === 'monthlyIncome') newValue = formatMoney(value);
    if (name === 'identityDocument') newValue = value.replace(/\D/g, '');

    setFormData((prev) => ({ ...prev, [name]: newValue }));

    if (errors[name]) {
      setErrors((prev) => {
        const newErrs = { ...prev };
        delete newErrs[name];
        return newErrs;
      });
    }
  };

  const handleApply = async (e: React.FormEvent) => {
    e.preventDefault();

    const parsed = membershipRequestInput.safeParse(formData);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === 'string' && !fieldErrors[key]) {
          fieldErrors[key] = issue.message;
        }
      }
      setErrors(fieldErrors);
      return;
    }

    setLoading(true);
    setGlobalError('');
    setErrors({});

    try {
      await createMembershipRequest(supabase, toMembershipRequestRow(parsed.data));
      router.push('/solicitud/confirmacion');
    } catch (err: unknown) {
      // Supabase PostgrestError no es instancia de Error — es un objeto plano
      // con { message, code, details, hint }. Si tratamos err como Error pura
      // perdemos el mensaje real. Loggeamos el error completo y extraemos
      // el mensaje del objeto si existe.
      console.error('[solicitud] createMembershipRequest falló:', err);

      if (isDuplicateDocumentError(err)) {
        setErrors({ identityDocument: 'Este documento de identidad ya se encuentra registrado' });
        setGlobalError('El documento ya está en revisión o registrado en el sistema.');
      } else {
        let message = 'Error inesperado al enviar la solicitud';
        if (err instanceof Error && err.message) {
          message = err.message;
        } else if (typeof err === 'object' && err !== null) {
          const e = err as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
          const parts = [e.message, e.details, e.hint]
            .filter((v): v is string => typeof v === 'string' && v.length > 0);
          if (parts.length > 0) {
            message = parts.join(' · ');
            if (typeof e.code === 'string' && e.code) message += ` [${e.code}]`;
          }
        } else if (typeof err === 'string' && err) {
          message = err;
        }
        setGlobalError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  const trustItems = [
    { icon: ShieldCheck, title: 'Datos protegidos', sub: 'Cifrado de extremo a extremo' },
    { icon: Clock, title: 'Respuesta rápida', sub: 'Revisión en 24 – 48 h' },
    { icon: Users, title: 'Familia verificada', sub: 'Solo por referido' },
  ];

  return (
    <div className="min-h-screen w-full bg-[var(--color-bg)]">
      {/* Top bar */}
      <div className="h-16 px-6 sm:px-10 flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg)]">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-[30px] h-[30px] rounded-[8px] bg-[var(--color-brand)] flex items-center justify-center text-white dark:text-[var(--color-brand-ink)]">
            <Logo size={18} color="currentColor" />
          </div>
          <span className="text-sm font-semibold tracking-tight">Ahorro Familiar</span>
        </Link>
        <div className="text-[13px] text-[var(--color-text-muted)]">
          ¿Ya eres miembro?{' '}
          <Link href="/login" className="text-[var(--color-brand)] font-semibold hover:underline">
            Inicia sesión →
          </Link>
        </div>
      </div>

      <div className="max-w-[920px] mx-auto my-10 px-6 sm:px-10 pb-16 grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-10">
        {/* Context column */}
        <div>
          <div className="text-[11px] font-semibold text-[var(--color-brand)] tracking-[0.14em] uppercase mb-3">
            Paso 1 de 1
          </div>
          <h1 className="text-[28px] font-semibold tracking-[-0.025em] leading-[1.15] mb-3 text-[var(--color-text)]">
            Únete al grupo de ahorro familiar
          </h1>
          <p className="text-sm text-[var(--color-text-muted)] leading-[1.55] mb-7">
            Completa tus datos básicos. Un administrador revisará tu solicitud y recibirás
            una respuesta por correo en menos de 48 horas.
          </p>

          <div className="flex flex-col gap-3">
            {trustItems.map(({ icon: Icon, title, sub }) => (
              <div key={title} className="flex gap-3 items-start">
                <div className="w-8 h-8 rounded-[8px] bg-[var(--color-brand-soft)] text-[var(--color-brand)] flex items-center justify-center shrink-0">
                  <Icon size={15} strokeWidth={1.75} />
                </div>
                <div>
                  <div className="text-[13px] font-semibold tracking-tight">{title}</div>
                  <div className="text-xs text-[var(--color-text-muted)] mt-0.5">{sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Form card */}
        <Card padding="lg" className="p-7">
          <div className="text-[15px] font-semibold tracking-tight mb-1">Información personal</div>
          <div className="text-xs text-[var(--color-text-muted)] mb-6">
            Todos los campos son obligatorios.
          </div>

          {globalError && (
            <div className="mb-4 p-3.5 rounded-[10px] bg-[var(--color-danger-soft)] text-[var(--color-danger)] text-sm font-medium">
              {globalError}
            </div>
          )}

          <form onSubmit={handleApply} className="space-y-3.5" noValidate>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <Input
                name="firstName"
                label="Nombres"
                icon={User}
                type="text"
                placeholder="Valentina"
                value={formData.firstName}
                onChange={handleChange}
                error={errors.firstName}
              />
              <Input
                name="lastName"
                label="Apellidos"
                icon={User}
                type="text"
                placeholder="Ríos Acevedo"
                value={formData.lastName}
                onChange={handleChange}
                error={errors.lastName}
              />
              <Input
                name="identityDocument"
                label="Documento de identidad"
                icon={IdCard}
                type="text"
                placeholder="52 118 903"
                value={formData.identityDocument}
                onChange={handleChange}
                error={errors.identityDocument}
                maxLength={20}
              />
              <Input
                name="phone"
                label="Celular"
                icon={Phone}
                type="tel"
                placeholder="301 445 2210"
                value={formData.phone}
                onChange={handleChange}
                error={errors.phone}
              />
              <div className="sm:col-span-2">
                <Input
                  name="email"
                  label="Correo electrónico"
                  icon={Mail}
                  type="email"
                  placeholder="valentina.rios@gmail.com"
                  value={formData.email}
                  onChange={handleChange}
                  error={errors.email}
                />
              </div>
              <div className="sm:col-span-2">
                <Input
                  name="address"
                  label="Dirección"
                  icon={MapPin}
                  type="text"
                  placeholder="Calle 93 # 11 – 47, Bogotá"
                  value={formData.address}
                  onChange={handleChange}
                  error={errors.address}
                />
              </div>
              <div className="sm:col-span-2">
                <Input
                  name="monthlyIncome"
                  label="Ingreso mensual (COP)"
                  icon={DollarSign}
                  type="text"
                  placeholder="3 200 000"
                  value={formData.monthlyIncome}
                  onChange={handleChange}
                  error={errors.monthlyIncome}
                />
              </div>
            </div>

            <div className="mt-5 p-3.5 rounded-[10px] bg-[var(--color-surface-alt)] border border-[var(--color-border)] flex gap-2.5 text-xs text-[var(--color-text-muted)] leading-[1.5]">
              <ShieldCheck size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" />
              <div>
                Al enviar aceptas el reglamento interno del fondo y confirmas que la información
                aportada es verídica.
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2.5">
              <Button
                type="button"
                variant="secondary"
                size="lg"
                onClick={() => router.back()}
              >
                Cancelar
              </Button>
              <Button type="submit" size="lg" disabled={loading}>
                {loading ? 'Enviando...' : 'Enviar solicitud'}
                <ArrowRight size={15} strokeWidth={1.75} />
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
