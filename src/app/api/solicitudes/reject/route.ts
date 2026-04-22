import { NextResponse, after } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rejectRequestPayload } from '@/lib/schemas/membership-request';
import {
  getMembershipRequest,
  updateMembershipRequestStatus,
} from '@/lib/data/membership-requests';
import { sendMail } from '@/lib/emails/transport';
import {
  buildRejectionEmail,
  membershipEmailSubjects,
} from '@/lib/emails/membership';

export async function POST(request: Request) {
  try {
    const authCheck = await requireAdmin();
    if ('error' in authCheck) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const parsed = rejectRequestPayload.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { id, reason } = parsed.data;
    const admin = createSupabaseAdminClient();

    let req;
    try {
      req = await getMembershipRequest(admin, id);
    } catch {
      return NextResponse.json({ error: 'Solicitud no encontrada' }, { status: 404 });
    }

    if (req.status !== 'pending') {
      return NextResponse.json(
        { error: `La solicitud ya está ${req.status === 'approved' ? 'aprobada' : 'rechazada'}` },
        { status: 409 },
      );
    }

    try {
      await updateMembershipRequestStatus(admin, id, 'rejected', reason);
    } catch {
      return NextResponse.json({ error: 'Fallo al actualizar la base de datos' }, { status: 500 });
    }

    const firstName = req.first_name;
    const userEmail = req.email;

    after(async () => {
      const result = await sendMail({
        to: userEmail,
        subject: membershipEmailSubjects.rejection,
        html: buildRejectionEmail({ firstName, reason }),
      });
      if (!result.ok) {
        console.error('Error background sending reject email:', result);
      }
    });

    if (!process.env.GMAIL_EMAIL || !process.env.GMAIL_APP_PASSWORD) {
      return NextResponse.json({
        success: true,
        warning: 'Solicitud actualizada. Correo omitido (faltan variables GMAIL_*)',
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('API Error:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
