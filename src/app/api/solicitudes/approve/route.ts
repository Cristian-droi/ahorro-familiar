import { NextResponse, after } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { approveRequestPayload } from '@/lib/schemas/membership-request';
import {
  getMembershipRequest,
  updateMembershipRequestStatus,
} from '@/lib/data/membership-requests';
import { upsertProfile } from '@/lib/data/profiles';
import { sendMail } from '@/lib/emails/transport';
import {
  buildApprovalEmail,
  membershipEmailSubjects,
} from '@/lib/emails/membership';

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

    // Fuente de verdad: la solicitud en DB (no confiamos en el body del cliente).
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

    // Crear usuario en Auth. El email interno usa el documento.
    const authEmail = `${req.identity_document}@ahorro.com`;
    const { data: newAuthUser, error: createUserError } = await admin.auth.admin.createUser({
      email: authEmail,
      password: req.identity_document,
      email_confirm: true,
      user_metadata: {
        first_name: req.first_name,
        last_name: req.last_name,
        real_email: req.email,
      },
    });

    if (createUserError || !newAuthUser?.user) {
      console.error('Error creating user in Auth:', createUserError);
      return NextResponse.json(
        { error: 'Fallo al registrar usuario. Verifica que el documento no exista ya.' },
        { status: 500 },
      );
    }

    // Crear profile. El rol autoritativo vive aquí, no en user_metadata.
    try {
      await upsertProfile(admin, {
        id: newAuthUser.user.id,
        first_name: req.first_name,
        last_name: req.last_name ?? '',
        identity_document: req.identity_document,
        phone: req.phone,
        address: req.address,
        monthly_income: req.monthly_income,
        role: 'accionista',
      });
    } catch (err) {
      console.error('Error creando profile:', err);
      return NextResponse.json({ error: 'Fallo al crear el perfil' }, { status: 500 });
    }

    // Link de recovery para que el usuario defina su contraseña real.
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email: authEmail,
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/update-password`,
      },
    });

    if (linkError || !linkData?.properties?.action_link) {
      console.error('Error generating link:', linkError);
      return NextResponse.json({ error: 'Fallo al generar el enlace de activación' }, { status: 500 });
    }

    try {
      await updateMembershipRequestStatus(admin, id, 'approved');
    } catch {
      return NextResponse.json({ error: 'Fallo al actualizar la solicitud' }, { status: 500 });
    }

    const actionLink = linkData.properties.action_link;
    const firstName = req.first_name;
    const userEmail = req.email;

    // Despacho en background: el usuario ya está aprobado aunque el correo falle.
    after(async () => {
      const result = await sendMail({
        to: userEmail,
        subject: membershipEmailSubjects.approval,
        html: buildApprovalEmail({ firstName, actionLink }),
      });
      if (!result.ok) {
        console.error('Error background sending approve email:', result);
      }
    });

    if (!process.env.GMAIL_EMAIL || !process.env.GMAIL_APP_PASSWORD) {
      return NextResponse.json({
        success: true,
        warning: 'Usuario creado. Correo omitido (faltan variables GMAIL_*)',
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('API Error:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
