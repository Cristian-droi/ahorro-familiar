import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Logo } from '@/components/ui/Logo';
import { CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

// Página pública que se abre al hacer clic en el enlace del correo de
// verificación de cambio de correo. Valida el token, aplica el cambio al
// user_metadata.real_email y muestra el resultado.
//
// NO toca auth.users.email (ese es el login sintético <cedula>@ahorro.com).
//
// Consideraciones:
//   - La página la visita alguien que probablemente NO está logueado en ese
//     navegador (abrió el correo en su móvil). Por eso hacemos la validación
//     con el admin client (service role) a partir del token.
//   - El token es de un solo uso: al confirmar, marcamos confirmed_at.
//   - Si ya fue usado o está expirado, mostramos un mensaje amigable.

type VerifyStatus =
  | { kind: 'ok'; newEmail: string }
  | { kind: 'expired' }
  | { kind: 'used' }
  | { kind: 'canceled' }
  | { kind: 'missing' }
  | { kind: 'not_found' }
  | { kind: 'error'; message?: string };

async function verifyToken(token: string | undefined): Promise<VerifyStatus> {
  if (!token) return { kind: 'missing' };

  const admin = createSupabaseAdminClient();
  const { data: req, error } = await admin
    .from('email_change_requests')
    .select('id, user_id, new_email, expires_at, confirmed_at, canceled_at')
    .eq('token', token)
    .maybeSingle();

  if (error) {
    console.error('verify-email-change: fallo al leer solicitud', {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    });
    return { kind: 'error', message: error.message };
  }
  if (!req) return { kind: 'not_found' };
  if (req.canceled_at) return { kind: 'canceled' };
  if (req.confirmed_at) return { kind: 'used' };
  if (new Date(req.expires_at).getTime() < Date.now()) {
    return { kind: 'expired' };
  }

  // Aplica el cambio al user_metadata.real_email y marca la solicitud como
  // confirmada. Preservamos el resto del metadata.
  const { data: userData, error: userError } =
    await admin.auth.admin.getUserById(req.user_id);
  if (userError || !userData?.user) {
    console.error('verify-email-change: no se pudo leer el auth user', userError);
    return { kind: 'error', message: userError?.message };
  }

  const currentMeta = (userData.user.user_metadata ?? {}) as Record<
    string,
    unknown
  >;
  const { error: updateError } = await admin.auth.admin.updateUserById(
    req.user_id,
    {
      user_metadata: { ...currentMeta, real_email: req.new_email },
    },
  );
  if (updateError) {
    console.error(
      'verify-email-change: fallo al actualizar user_metadata',
      updateError,
    );
    return { kind: 'error', message: updateError.message };
  }

  const { error: confirmError } = await admin
    .from('email_change_requests')
    .update({ confirmed_at: new Date().toISOString() })
    .eq('id', req.id);
  if (confirmError) {
    console.error(
      'verify-email-change: fallo al marcar confirmed_at',
      confirmError,
    );
    // El cambio ya se aplicó; no bloqueamos al usuario por esto.
  }

  return { kind: 'ok', newEmail: req.new_email };
}

export default async function VerifyEmailChangePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const status = await verifyToken(token);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10 bg-[var(--color-bg)]">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-6">
          <Logo />
        </div>
        <Card padding="lg">
          <StatusView status={status} />
        </Card>
      </div>
    </div>
  );
}

function StatusView({ status }: { status: VerifyStatus }) {
  if (status.kind === 'ok') {
    return (
      <div className="text-center">
        <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-[var(--color-success-soft)] flex items-center justify-center">
          <CheckCircle2 className="w-7 h-7 text-[var(--color-success)]" />
        </div>
        <h1 className="text-xl font-semibold text-[var(--color-text)] mb-2">
          ¡Correo confirmado!
        </h1>
        <p className="text-[var(--color-text-muted)] text-sm leading-relaxed mb-6">
          Tu correo de contacto ahora es{' '}
          <strong className="text-[var(--color-text)]">{status.newEmail}</strong>
          . A partir de ahora todas las notificaciones llegarán a esta dirección.
        </p>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-[10px] bg-[var(--color-brand)] text-white text-sm font-medium hover:opacity-90"
        >
          Ir al panel <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    );
  }

  const messages: Record<Exclude<VerifyStatus['kind'], 'ok'>, string> = {
    expired:
      'Este enlace de verificación ya expiró. Vuelve a Ajustes y solicita un nuevo cambio de correo.',
    used: 'Este enlace ya fue usado. El cambio de correo quedó aplicado anteriormente.',
    canceled:
      'Esta solicitud fue cancelada (puede que hayas pedido otra nueva después). Si aún quieres cambiar tu correo, inicia el proceso otra vez desde Ajustes.',
    missing: 'El enlace no trae token. Asegúrate de abrirlo desde el correo original.',
    not_found:
      'No encontramos esta solicitud. Puede que el enlace esté mal copiado o haya sido invalidado.',
    error:
      'Ocurrió un problema al confirmar el cambio. Intenta de nuevo o contacta a soporte.',
  };

  return (
    <div className="text-center">
      <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-[var(--color-danger-soft)] flex items-center justify-center">
        <AlertTriangle className="w-7 h-7 text-[var(--color-danger)]" />
      </div>
      <h1 className="text-xl font-semibold text-[var(--color-text)] mb-2">
        No pudimos aplicar el cambio
      </h1>
      <p className="text-[var(--color-text-muted)] text-sm leading-relaxed mb-6">
        {messages[status.kind]}
      </p>
      <Link
        href="/dashboard/ajustes"
        className="inline-flex items-center gap-2 px-4 py-2 rounded-[10px] bg-[var(--color-brand)] text-white text-sm font-medium hover:opacity-90"
      >
        Ir a Ajustes <ArrowRight className="w-4 h-4" />
      </Link>
    </div>
  );
}
