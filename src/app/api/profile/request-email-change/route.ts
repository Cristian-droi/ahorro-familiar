import { NextResponse, after } from 'next/server';
import { randomBytes } from 'node:crypto';
import { requireUser } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { requestEmailChangeInput } from '@/lib/schemas/profile';
import { getProfile } from '@/lib/data/profiles';
import { sendMail } from '@/lib/emails/transport';
import {
  buildEmailChangeEmail,
  emailChangeSubject,
} from '@/lib/emails/email-change';

// POST /api/profile/request-email-change
//
// Inicia un cambio de correo REAL (el que vive en user_metadata.real_email).
// NO toca auth.users.email — ese es el login sintético <cedula>@ahorro.com.
//
// Flujo:
//   1. Auth + validación del payload.
//   2. Cancela solicitudes pendientes previas del mismo usuario.
//   3. Genera un token aleatorio y crea una fila en email_change_requests
//      con expiración de 24h.
//   4. Envía en background un correo al nuevo email con un enlace
//      /verify-email-change?token=...
//   5. La confirmación ocurre en la página pública (otro endpoint/server
//      component) que valida el token y aplica el cambio al metadata.

const TOKEN_BYTES = 32;
const EXPIRY_HOURS = 24;

export async function POST(request: Request) {
  try {
    const authCheck = await requireUser();
    if ('error' in authCheck) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status },
      );
    }
    const { user } = authCheck;

    const parsed = requestEmailChangeInput.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const newEmail = parsed.data.new_email;

    const admin = createSupabaseAdminClient();

    // Si el correo nuevo es igual al actual, no hacemos nada.
    const currentRealEmail =
      (user.user_metadata as { real_email?: string } | null)?.real_email ??
      null;
    if (
      currentRealEmail &&
      currentRealEmail.toLowerCase() === newEmail.toLowerCase()
    ) {
      return NextResponse.json(
        { error: 'Ese ya es tu correo actual.' },
        { status: 400 },
      );
    }

    // Cancela solicitudes pendientes previas del mismo usuario (si existen).
    await admin
      .from('email_change_requests')
      .update({ canceled_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .is('confirmed_at', null)
      .is('canceled_at', null);

    const token = randomBytes(TOKEN_BYTES).toString('hex');
    const expiresAt = new Date(
      Date.now() + EXPIRY_HOURS * 60 * 60 * 1000,
    ).toISOString();

    const { error: insertError } = await admin
      .from('email_change_requests')
      .insert({
        user_id: user.id,
        new_email: newEmail,
        token,
        expires_at: expiresAt,
      });
    if (insertError) {
      console.error('request-email-change: insert falló', {
        message: insertError.message,
        details: insertError.details,
        hint: insertError.hint,
        code: insertError.code,
      });
      return NextResponse.json(
        { error: 'No se pudo crear la solicitud de cambio de correo.' },
        { status: 500 },
      );
    }

    const profile = await getProfile(admin, user.id);
    const firstName = profile.first_name ?? '';

    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    const actionLink = `${siteUrl}/verify-email-change?token=${encodeURIComponent(
      token,
    )}`;

    if (!process.env.GMAIL_EMAIL || !process.env.GMAIL_APP_PASSWORD) {
      console.warn(
        'request-email-change: GMAIL_* no configurados, se omite envío para',
        user.id,
      );
      return NextResponse.json({ success: true });
    }

    after(async () => {
      const result = await sendMail({
        to: newEmail,
        subject: emailChangeSubject,
        html: buildEmailChangeEmail({
          firstName,
          actionLink,
          newEmail,
        }),
      });
      if (!result.ok) {
        console.error(
          'request-email-change: fallo al enviar correo:',
          result,
        );
      }
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('API Error /api/profile/request-email-change:', err);
    return NextResponse.json(
      { error: 'Error inesperado' },
      { status: 500 },
    );
  }
}
