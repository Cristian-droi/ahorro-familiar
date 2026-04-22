'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
import { IdCard, Lock, ShieldCheck, ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { getProfileRole } from '@/lib/data/profiles';

export default function LoginPage() {
  const router = useRouter();
  const [document, setDocument] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ document?: string; password?: string }>({});

  const validate = () => {
    const newErrors: typeof errors = {};
    if (!document) newErrors.document = 'El número de documento es obligatorio';
    if (!password) newErrors.password = 'La contraseña es obligatoria';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    setErrors({});

    const emailStr = `${document}@ahorro.com`;

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: emailStr,
        password: password,
      });

      if (error) throw error;

      // La fuente de verdad del rol es `profiles.role`. `user_metadata` no es
      // confiable: puede quedar desactualizado y cualquier fallback que caiga
      // en 'admin' concede visualmente permisos que el usuario no tiene.
      // Si el profile no existe (inconsistencia), tratamos al usuario como
      // accionista. El acceso admin real se protege en el servidor con
      // requireAdmin().
      let role: 'admin' | 'accionista' | null = null;
      if (data.user?.id) {
        try {
          role = await getProfileRole(supabase, data.user.id);
        } catch (err) {
          console.error('Error leyendo role del profile tras login:', err);
        }
      }

      router.refresh();
      router.push(role === 'admin' ? '/dashboard/admin' : '/dashboard/accionista');
    } catch {
      setErrors({ password: 'Tus credenciales son incorrectas o hubo un error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex bg-[var(--color-bg)]">
      {/* Brand rail — visible en desktop */}
      <aside className="hidden lg:flex lg:w-[520px] relative flex-col justify-between p-14 text-white overflow-hidden gradient-brand-rail">
        <div className="flex items-center gap-3 relative z-10">
          <Logo size={28} color="#ffffff" />
          <span className="text-[15px] font-semibold tracking-tight">Ahorro Familiar</span>
        </div>

        <div className="relative z-10">
          <h1 className="text-[40px] font-semibold tracking-[-0.045em] leading-[1.08] max-w-[380px] mb-5">
            Tu grupo de ahorro, con la claridad de un banco.
          </h1>
          <p className="text-[15px] leading-[1.55] max-w-[360px] text-white/75">
            Administra aportes, préstamos y rendimientos con transparencia total.
            Diseñado para familias que ahorran juntas.
          </p>
        </div>

        {/* Coin stack — geometric illustration */}
        <div className="absolute right-[-80px] bottom-[-40px] opacity-25 pointer-events-none">
          <svg width="420" height="320" viewBox="0 0 420 320" fill="none">
            <ellipse cx="210" cy="240" rx="180" ry="44" stroke="#fff" strokeWidth="1.5" />
            <ellipse cx="210" cy="180" rx="150" ry="36" stroke="#fff" strokeWidth="1.5" />
            <ellipse cx="210" cy="130" rx="120" ry="28" stroke="#fff" strokeWidth="1.5" />
            <ellipse cx="210" cy="90"  rx="90"  ry="20" stroke="#fff" strokeWidth="1.5" />
          </svg>
        </div>

        <div className="text-xs text-white/55 tracking-wide relative z-10">
          © 2026 · Grupo familiar privado
        </div>
      </aside>

      {/* Form column */}
      <main className="flex-1 flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-[400px]">
          {/* Logo compact (solo en mobile) */}
          <div className="lg:hidden flex items-center gap-2 mb-10">
            <div className="w-8 h-8 rounded-[8px] bg-[var(--color-brand)] flex items-center justify-center text-white dark:text-[var(--color-brand-ink)]">
              <Logo size={18} color="currentColor" />
            </div>
            <span className="text-sm font-semibold tracking-tight">Ahorro Familiar</span>
          </div>

          <div className="text-[11px] font-semibold text-[var(--color-brand)] tracking-[0.14em] uppercase mb-3">
            Iniciar sesión
          </div>
          <h2 className="text-[32px] font-semibold tracking-[-0.025em] leading-[1.15] mb-2 text-[var(--color-text)]">
            Bienvenido de nuevo
          </h2>
          <p className="text-sm text-[var(--color-text-muted)] mb-9">
            Ingresa con tu documento para acceder a tu capital.
          </p>

          <form onSubmit={handleLogin} className="space-y-[18px]" noValidate>
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
            <Input
              label="Contraseña"
              icon={Lock}
              type="password"
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errors.password) setErrors({ ...errors, password: undefined });
              }}
              error={errors.password}
            />

            <div className="flex justify-end pt-1">
              <Link
                href="/forgot-password"
                className="text-[13px] font-medium text-[var(--color-brand)] hover:underline"
              >
                ¿Olvidaste tu contraseña?
              </Link>
            </div>

            <Button
              type="submit"
              size="lg"
              className="w-full mt-4"
              disabled={loading}
            >
              {loading ? 'Iniciando...' : 'Iniciar sesión'}
              <ArrowRight size={16} strokeWidth={1.75} />
            </Button>
          </form>

          <div className="mt-6 px-3.5 py-3 rounded-[10px] border border-[var(--color-border)] flex items-center gap-2.5 text-xs text-[var(--color-text-muted)]">
            <ShieldCheck size={15} strokeWidth={1.75} className="text-[var(--color-brand)] shrink-0" />
            <span>Conexión cifrada extremo a extremo · Verificado por Supabase</span>
          </div>

          <div className="mt-10 pt-6 border-t border-[var(--color-border)] text-sm text-[var(--color-text-muted)] text-center">
            ¿Aún no eres miembro?{' '}
            <Link
              href="/solicitud"
              className="text-[var(--color-brand)] font-semibold hover:underline"
            >
              Solicita tu ingreso →
            </Link>
          </div>
        </div>
      </main>

      <style jsx>{`
        .gradient-brand-rail {
          background:
            radial-gradient(1200px 600px at 20% 0%, rgba(10, 107, 59, 0.10), transparent 60%),
            linear-gradient(180deg, #0A6B3B 0%, #064a28 100%);
        }
        :global(.dark) .gradient-brand-rail {
          background:
            radial-gradient(1200px 600px at 20% 0%, rgba(74, 222, 128, 0.14), transparent 60%),
            linear-gradient(180deg, #0E1512 0%, #0B0F0C 100%);
          color: var(--color-text);
        }
      `}</style>
    </div>
  );
}
