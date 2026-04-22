import { NextResponse, after } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { passwordResetInput } from '@/lib/schemas/password-reset';
import { getProfileByDocument } from '@/lib/data/profiles';
import { sendMail } from '@/lib/emails/transport';
import {
  buildPasswordResetEmail,
  membershipEmailSubjects,
} from '@/lib/emails/membership';

// Endpoint público para "Olvidé mi contraseña".
//
// Flujo:
//   1. El usuario manda su número de documento.
//   2. Buscamos el profile correspondiente; si no existe, respondemos con
//      éxito genérico de todas formas (evita enumerar documentos válidos).
//   3. Tomamos el `real_email` desde los metadatos del usuario en Auth
//      (lo guardó `approve/route.ts` al crear la cuenta).
//   4. Generamos un recovery link apuntando a /update-password.
//   5. Enviamos el correo en background y respondemos de inmediato.
//
// Importante:
//   - La respuesta es SIEMPRE genérica. No le decimos al cliente si el
//     documento existe o no.
//   - El envío del correo no bloquea la respuesta (after()), igual que en
//     approve/reject. Si el envío falla, queda en logs.

export async function POST(request: Request) {
  try {
    const parsed = passwordResetInput.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { identityDocument } = parsed.data;
    const admin = createSupabaseAdminClient();

    const profile = await getProfileByDocument(admin, identityDocument);

    // Respuesta genérica: no distinguimos "no existe" de "existe pero fallo
    // interno" desde el cliente. El admin se entera por logs.
    const genericOk = NextResponse.json({ success: true });

    if (!profile) {
      // Documento desconocido: respondemos ok para no exponer qué documentos
      // están registrados.
      return genericOk;
    }

    // Necesitamos el email real (no el `{doc}@ahorro.com` interno) para
    // enviarle el correo. Lo guardamos en user_metadata al crear la cuenta.
    const { data: userData, error: userError } = await admin.auth.admin.getUserById(
      profile.id,
    );
    if (userError || !userData?.user) {
      console.error('Password reset: no se pudo leer el auth user:', userError);
      return genericOk;
    }

    const realEmail =
      (userData.user.user_metadata as { real_email?: string } | null)?.real_email ??
      null;
    if (!realEmail) {
      console.error(
        'Password reset: el user_metadata.real_email está vacío para',
        profile.id,
      );
      return genericOk;
    }

    const authEmail = `${identityDocument}@ahorro.com`;
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email: authEmail,
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/update-password`,
      },
    });

    if (linkError || !linkData?.properties?.action_link) {
      console.error('Password reset: fallo al generar recovery link:', linkError);
      return genericOk;
    }

    const actionLink = linkData.properties.action_link;
    const firstName = profile.first_name ?? '';

    // Si no hay credenciales de correo, loggeamos y seguimos. La respuesta
    // al cliente sigue siendo genérica para no revelar configuración.
    if (!process.env.GMAIL_EMAIL || !process.env.GMAIL_APP_PASSWORD) {
      console.warn(
        'Password reset: GMAIL_* no configurados, se omite envío para',
        identityDocument,
      );
      return genericOk;
    }

    after(async () => {
      const result = await sendMail({
        to: realEmail,
        subject: membershipEmailSubjects.passwordReset,
        html: buildPasswordResetEmail({ firstName, actionLink }),
      });
      if (!result.ok) {
        console.error('Password reset: fallo al enviar correo:', result);
      }
    });

    return genericOk;
  } catch (err) {
    console.error('API Error /api/password-reset:', err);
    // Mismo criterio: no distinguimos error interno desde el cliente.
    return NextResponse.json({ success: true });
  }
}
