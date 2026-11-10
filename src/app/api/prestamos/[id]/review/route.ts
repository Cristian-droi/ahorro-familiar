import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { EXPIRED_REQUEST_MESSAGE, expireLoanRequestIfDue } from '@/lib/loan-expiry';
import { reviewPlanSchema } from '@/lib/schemas/loan';
import { auditedUpdate, isStaleStatus } from '@/lib/audit';
import { getOpenPeriodShareValue } from '@/lib/data/share-value';
import { validarPuedeComprar } from '@/modules/acciones/domain/valor-de-accion';
import { ajustarAccionesPorPrestamo } from '@/modules/prestamos/domain/acciones-por-prestamo';

// POST /api/prestamos/[id]/review — admin aprueba o rechaza el plan de pagos.
// Al aprobar el plan, el admin luego decide cuándo mandarlo a votación.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const authCheck = await requireAdmin();
    if ('error' in authCheck) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const body = await request.json();
    const parsed = reviewPlanSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
    }
    const { action, rejection_reason, admin_notes, loan_shares_count, loan_shares_reason } = parsed.data;

    if (action === 'reject' && !rejection_reason) {
      return NextResponse.json({ error: 'Debes indicar un motivo de rechazo' }, { status: 422 });
    }

    const admin = createSupabaseAdminClient();

    const { data: loan, error: fetchError } = await admin
      .from('loans')
      .select('id, status, submitted_at, user_id, loan_shares_count, loan_shares_suggested')
      .eq('id', id)
      .maybeSingle();

    if (fetchError || !loan) {
      return NextResponse.json({ error: 'Préstamo no encontrado' }, { status: 404 });
    }
    // RN-4.5b: an expired request is annulled before any action.
    if (await expireLoanRequestIfDue(admin, loan)) {
      return NextResponse.json({ error: EXPIRED_REQUEST_MESSAGE }, { status: 409 });
    }
    if (loan.status !== 'pending_review') {
      return NextResponse.json({ error: `El préstamo no está en revisión (estado: ${loan.status})` }, { status: 409 });
    }

    // RN-4.12: the tesorero may change the loan shares when approving. The
    // suggested count is the RN-4.10 one, kept from the first change.
    let sharesPatch: {
      loan_shares_count: number;
      loan_shares_amount: number;
      loan_shares_suggested: number;
      loan_shares_override_reason: string | null;
    } | null = null;
    let sharesReason: string | null = null;
    if (action === 'approve' && loan_shares_count !== undefined) {
      const suggested = loan.loan_shares_suggested ?? Number(loan.loan_shares_count ?? 0);
      if (loan_shares_count !== Number(loan.loan_shares_count ?? 0) || loan.loan_shares_suggested != null) {
        let shareValue: number | null = null;
        try {
          shareValue = await getOpenPeriodShareValue(admin, loan.user_id);
        } catch (shareValueErr) {
          console.error('review: no se pudo leer el valor de acción del periodo', shareValueErr);
          return NextResponse.json({ error: 'No se pudo leer el valor de acción del accionista' }, { status: 500 });
        }
        const puedeComprar = validarPuedeComprar({ valorDeAccion: shareValue });
        if (!puedeComprar.ok) {
          return NextResponse.json({ error: puedeComprar.error.mensaje }, { status: 422 });
        }
        const ajuste = ajustarAccionesPorPrestamo({
          sugerida: suggested,
          final: loan_shares_count,
          valorAccion: puedeComprar.value,
          motivo: loan_shares_reason,
        });
        if (!ajuste.ok) {
          return NextResponse.json({ error: ajuste.error.mensaje }, { status: 422 });
        }
        const reason = ajuste.value.cambio ? loan_shares_reason!.trim() : null;
        sharesPatch = {
          loan_shares_count: ajuste.value.cantidad,
          loan_shares_amount: ajuste.value.valor,
          loan_shares_suggested: suggested,
          loan_shares_override_reason: reason,
        };
        if (reason) {
          sharesReason = `Acciones por préstamo: sugeridas ${suggested}, finales ${ajuste.value.cantidad}. Motivo: ${reason}`;
        }
      }
    }

    const updates =
      action === 'approve'
        ? {
            plan_status: 'approved' as const,
            plan_rejection_reason: null,
            admin_notes: admin_notes ?? null,
            updated_at: new Date().toISOString(),
            ...(sharesPatch ?? {}),
          }
        : action === 'request_revision'
          ? {
              status: 'draft' as const,
              plan_status: null,
              plan_rejection_reason: null,
              admin_notes: admin_notes ?? null,
              updated_at: new Date().toISOString(),
            }
          : {
              plan_status: 'rejected' as const,
              plan_rejection_reason: rejection_reason,
              admin_notes: admin_notes ?? null,
              status: 'rejected_by_admin' as const,
              rejection_reason,
              updated_at: new Date().toISOString(),
            };

    const { error: updateError } = await auditedUpdate(admin, {
      entity: 'loans',
      id,
      patch: updates,
      actorId: authCheck.user.id,
      action: `loan.review.${action}`,
      expectedStatus: 'pending_review',
      reason: [sharesReason, rejection_reason ?? admin_notes].filter(Boolean).join(' · ') || undefined,
    });

    if (isStaleStatus(updateError)) {
      return NextResponse.json({ error: 'Otra persona ya cambió este préstamo.' }, { status: 409 });
    }
    if (updateError) {
      return NextResponse.json({ error: 'No se pudo actualizar el préstamo' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('API Error POST /api/prestamos/[id]/review:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
