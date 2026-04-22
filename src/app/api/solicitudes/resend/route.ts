import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { approveRequestPayload } from '@/lib/schemas/membership-request';
import { getMembershipRequest } from '@/lib/data/membership-requests';
import { sendMail } from '@/lib/emails/transport';
import {
  buildApprovalEmail,
  buildRejectionEmail,
  membershipEmailSubjects,
} from '@/lib/emails/membership';

// Reenvía el correo de aprobación o rechazo de una solicitud ya resuelta.
//
// Para solicitudes aprobadas:
//   - Regenera un link de recovery nuevo (los recovery links de Supabase
//     expiran en 1 h, así que reutilizar el del flujo original casi siempre
//     estaría vencido).
//   - Reenvía el correo de bienvenida con ese link.
//
// Para solicitudes rechazadas:
//   - Reenvía el correo con la `rejection_reason` guardada en DB.
//
// Para solicitudes pendientes:
//   - Responde 409 (aún no existe un correo a reenviar).
//
// A diferencia de approve/reject, este endpoint espera la respuesta del
// envío antes de responder al cliente. La semántica de "Reenviar" es que el
// admin quiere saber si salió el correo — no tiene sentido hacerlo fire-and-
// forget aquí.

export async function POST(request: Request) {
  try {
    const authCheck = await requireAdmin();
    if ('error' in authCheck) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const parsed = approveRequestPayload.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { id } = parsed.data;
    const admin = createSupabaseAdminClient();

    let req;
    try {
      req = await getMembershipRequest(admin, id);
    } catch {
      return NextResponse.json({ error: 'Solicitud no encontrada' }, { status: 404 });
    }

    if (req.status === 'pending') {
      return NextResponse.json(
        { error: 'La solicitud aún está pendiente. Primero debes aprobarla o rechazarla.' },
        { status: 409 },
      );
    }

    if (!process.env.GMAIL_EMAIL || !process.env.GMAIL_APP_PASSWORD) {
      return NextResponse.json(
        { error: 'No hay credenciales de correo configuradas (GMAIL_EMAIL / GMAIL_APP_PASSWORD).' },
        { status: 503 },
      );
    }

    const firstName = req.first_name;
    const userEmail = req.email;

    if (req.status === 'approved') {
      const authEmail = `${req.identity_document}@ahorro.com`;
      const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
        type: 'recovery',
        email: authEmail,
        options: {
          redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/update-password`,
        },
      });

      if (linkError || !linkData?.properties?.action_link) {
        console.error('Error regenerando link de recovery:', linkError);
        return NextResponse.json(
          { error: 'No se pudo regenerar el enlace de activación.' },
          { status: 500 },
        );
      }

      const result = await sendMail({
        to: userEmail,
        subject: membershipEmailSubjects.approval,
        html: buildApprovalEmail({ firstName, actionLink: linkData.properties.action_link }),
      });

      if (!result.ok) {
        console.error('Fallo al reenviar correo de aprobación:', result);
        return NextResponse.json(
          { error: 'No se pudo enviar el correo. Intenta de nuevo en unos minutos.' },
          { status: 502 },
        );
      }

      return NextResponse.json({ success: true, type: 'approval' });
    }

    // req.status === 'rejected'
    const reason = req.rejection_reason?.trim();
    if (!reason) {
      return NextResponse.json(
        { error: 'La solicitud está rechazada pero no tiene un motivo guardado. No se puede reenviar.' },
        { status: 422 },
      );
    }

    const result = await sendMail({
      to: userEmail,
      subject: membershipEmailSubjects.rejection,
      html: buildRejectionEmail({ firstName, reason }),
    });

    if (!result.ok) {
      console.error('Fallo al reenviar correo de rechazo:', result);
      return NextResponse.json(
        { error: 'No se pudo enviar el correo. Intenta de nuevo en unos minutos.' },
        { status: 502 },
      );
    }

    return NextResponse.json({ success: true, type: 'rejection' });
  } catch (err) {
    console.error('API Error:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
