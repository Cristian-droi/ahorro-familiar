'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
import {
  Lock,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  LogIn,
  KeyRound,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { getProfileRole } from '@/lib/data/profiles';

// Estado de validación del enlace de recovery.
//   - 'verifying'    : todavía estamos leyendo el hash / sesión.
//   - 'ready'        : hay sesión de recovery activa; mostramos el form.
//   - 'invalid'      : el link no sirve (expiró, ya se usó, o no había hash).
//                      En ese caso la contraseña probablemente ya fue creada
//                      antes, así que empujamos al usuario a iniciar sesión o
//                      a solicitar un nuevo enlace.
//
// Nota sobre "misma contraseña": si el usuario escribe exactamente la misma
// contraseña que ya tenía, Supabase responde con "New password should be
// different from the old password". Ese caso lo manejamos inline en el form
// (no sacamos al usuario de la página), porque la intención del flujo es
// definir contraseña — solo hay que pedir una diferente.
type LinkState = 'verifying' | 'ready' | 'invalid';

function UpdatePasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{
    password?: string;
    confirmPassword?: string;
    submit?: string;
  }>({});
  const [success, setSuccess] = useState(false);
  const [linkState, setLinkState] = useState<LinkState>('verifying');
  // Marca el caso específico "misma contraseña que la anterior". Aparte del
  // mensaje inline, disparamos un atajo a /login — suele ser lo que el
  // usuario realmente quería.
  const [samePasswordHint, setSamePasswordHint] = useState(false);

  useEffect(() => {
    let mounted = true;

    const initializeAuth = async () => {
      // El correo de recovery de Supabase viene con tokens en el hash
      // (`#access_token=...&refresh_token=...&type=recovery`). Cuando el
      // usuario hace clic, el hash está presente la primera vez. Si ya usó
      // ese link antes, el hash viene vacío o los tokens están consumidos.
      let hadHashAttempt = false;
      let hashSessionOk = false;

      if (typeof window !== 'undefined' && window.location.hash) {
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');

        if (accessToken && refreshToken) {
          hadHashAttempt = true;
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (!error) hashSessionOk = true;
        }
      }

      if (!mounted) return;

      // Si el hash traía tokens pero setSession falló → link inválido.
      if (hadHashAttempt && !hashSessionOk) {
        setLinkState('invalid');
        return;
      }

      // Sin hash: puede ser que el usuario refrescó la página después de
      // consumir el link, o entró directo sin venir del correo. Si no hay
      // sesión → inválido; si hay, dejamos pasar.
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setLinkState('invalid');
        return;
      }

      setLinkState('ready');
    };

    initializeAuth();

    return () => {
      mounted = false;
    };
  }, []);

  const validate = () => {
    const newErrors: typeof errors = {};
    if (!password) newErrors.password = 'La contraseña es obligatoria';
    else if (password.length < 6) newErrors.password = 'Debe tener al menos 6 caracteres';

    if (!confirmPassword) newErrors.confirmPassword = 'Debes confirmar la contraseña';
    else if (password !== confirmPassword)
      newErrors.confirmPassword = 'Las contraseñas no coinciden';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    setErrors({});

    try {
      const { data, error } = await supabase.auth.updateUser({ password });

      if (error) throw error;

      // Fuente de verdad del rol: `profiles.role`. No confiamos en
      // `user_metadata.role` (puede estar desactualizado o vacío).
      let role: 'admin' | 'accionista' | null = null;
      if (data.user?.id) {
        try {
          role = await getProfileRole(supabase, data.user.id);
        } catch (err) {
          console.error('Error leyendo role del profile tras update:', err);
        }
      }

      setSuccess(true);
      setTimeout(() => {
        router.refresh();
        router.push(role === 'admin' ? '/dashboard/admin' : '/dashboard/accionista');
      }, 2000);
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : '';
      const message = err instanceof Error ? err.message : '';
      const lowerMsg = message.toLowerCase();

      // Supabase devuelve "New password should be different from the old
      // password" cuando la cuenta ya tiene contraseña Y el usuario intentó
      // poner exactamente la misma. Es un caso esperado; lo tratamos inline
      // en el form (no sacamos al usuario de la página) y evitamos loggearlo
      // como error crítico porque dispararía el overlay de Next en dev.
      const isSamePassword =
        lowerMsg.includes('different from the old password') ||
        lowerMsg.includes('same_password') ||
        lowerMsg.includes('new password should be different');

      if (isSamePassword) {
        setSamePasswordHint(true);
        setErrors({
          password:
            'Esta contraseña es igual a la anterior. Elige una diferente para continuar.',
        });
      } else if (
        // Si el token expiró entre la validación inicial y el submit, mostramos
        // la UI de link inválido (con CTAs a login / forgot-password) en vez
        // de un banner genérico.
        name === 'AuthSessionMissingError' ||
        lowerMsg.includes('session')
      ) {
        console.error(err);
        setLinkState('invalid');
      } else {
        console.error(err);
        setErrors({
          submit: 'No se pudo actualizar tu contraseña. Intenta de nuevo en un momento.',
        });
      }
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)] p-6">
        <Card
          padding="lg"
          className="max-w-sm w-full text-center flex flex-col items-center gap-4 animate-in fade-in zoom-in duration-300"
        >
          <div className="w-14 h-14 rounded-full bg-[var(--color-success-soft)] text-[var(--color-success)] flex items-center justify-center">
            <CheckCircle2 size={26} strokeWidth={1.75} />
          </div>
          <h2 className="text-xl font-semibold tracking-tight">¡Contraseña lista!</h2>
          <p className="text-sm text-[var(--color-text-muted)] leading-[1.55]">
            Tu cuenta ya está activa. Redirigiendo al portal...
          </p>
        </Card>
      </div>
    );
  }

  // UI dedicada para cuando el enlace ya no sirve. Le damos dos salidas
  // claras al usuario:
  //   - Iniciar sesión (si ya tiene contraseña porque el link se usó antes).
  //   - Solicitar un nuevo enlace (si de verdad olvidó la contraseña).
  if (linkState === 'invalid') {
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
            <div className="w-14 h-14 rounded-full bg-[var(--color-warning-soft,var(--color-danger-soft))] text-[var(--color-warning,var(--color-danger))] flex items-center justify-center">
              <AlertTriangle size={24} strokeWidth={1.75} />
            </div>
            <h1 className="text-[22px] font-semibold tracking-[-0.02em] leading-[1.2]">
              Este enlace ya no es válido
            </h1>
            <p className="text-sm text-[var(--color-text-muted)] leading-[1.55]">
              Es posible que ya hayas creado tu contraseña, o que el enlace
              haya expirado (son de un solo uso). Puedes iniciar sesión o
              pedir uno nuevo.
            </p>

            <div className="w-full flex flex-col gap-2.5 pt-2">
              <Link href="/login" className="w-full">
                <Button size="lg" className="w-full">
                  <LogIn size={15} strokeWidth={1.75} />
                  Iniciar sesión
                </Button>
              </Link>
              <Link href="/forgot-password" className="w-full">
                <Button size="lg" variant="secondary" className="w-full">
                  <KeyRound size={15} strokeWidth={1.75} />
                  Solicitar un nuevo enlace
                </Button>
              </Link>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  const verifying = linkState === 'verifying';

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
          Seguridad
        </div>
        <h1 className="text-[28px] font-semibold tracking-[-0.025em] leading-[1.15] mb-2">
          Crea tu contraseña
        </h1>
        <p className="text-sm text-[var(--color-text-muted)] mb-8">
          Elige una contraseña segura que recordarás fácilmente.
        </p>

        <Card padding="lg" className="p-7">
          <form onSubmit={handleUpdate} className="space-y-4" noValidate>
            {errors.submit && (
              <div className="p-3.5 rounded-[10px] bg-[var(--color-danger-soft)] text-[var(--color-danger)] text-sm font-medium">
                {errors.submit}
              </div>
            )}

            <Input
              label="Nueva contraseña"
              icon={Lock}
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errors.password) setErrors({ ...errors, password: undefined });
                // Si el usuario está editando tras ver el aviso de "misma
                // contraseña", ocultamos la sugerencia inmediatamente.
                if (samePasswordHint) setSamePasswordHint(false);
              }}
              error={errors.password}
              disabled={verifying}
            />
            <Input
              label="Confirmar contraseña"
              icon={Lock}
              type="password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (errors.confirmPassword)
                  setErrors({ ...errors, confirmPassword: undefined });
              }}
              error={errors.confirmPassword}
              disabled={verifying}
            />

            {samePasswordHint && (
              <div className="px-3.5 py-3 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[13px] text-[var(--color-text-muted)] leading-[1.5]">
                <span className="block mb-2">
                  Parece que esa ya era tu contraseña anterior. Si solo querías
                  entrar a tu cuenta, puedes iniciar sesión directamente.
                </span>
                <Link
                  href="/login"
                  className="inline-flex items-center gap-1.5 font-semibold text-[var(--color-brand)] hover:underline"
                >
                  <LogIn size={13} strokeWidth={1.75} />
                  Ir a iniciar sesión
                </Link>
              </div>
            )}

            <Button
              type="submit"
              size="lg"
              className="w-full mt-2"
              disabled={loading || verifying}
            >
              {verifying ? 'Validando enlace...' : loading ? 'Guardando...' : 'Guardar y entrar'}
              {!(loading || verifying) && <ArrowRight size={15} strokeWidth={1.75} />}
            </Button>

            <div className="pt-2 flex items-center justify-center gap-2 text-[11px] font-semibold text-[var(--color-text-subtle)] tracking-[0.14em] uppercase">
              <ShieldCheck size={13} strokeWidth={1.75} />
              <span>Criptografía segura</span>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}

export default function UpdatePasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--color-bg)]" />}>
      <UpdatePasswordForm />
    </Suspense>
  );
}
