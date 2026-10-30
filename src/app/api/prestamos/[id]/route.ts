import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { updatePaymentPlanSchema } from '@/lib/schemas/loan';
import { agreedPlanFromRows, buildPaymentPlan } from '@/lib/loans';
import { hoyBogota, type FechaISO } from '@/shared/domain/fechas';

// PUT /api/prestamos/[id] — accionista actualiza el plan de pagos (solo en draft).
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireUser();
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { user } = auth;

    const body = await request.json();
    const parsed = updatePaymentPlanSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Datos inválidos' },
        { status: 400 },
      );
    }
    const { months, capital_overrides } = parsed.data;

    const admin = createSupabaseAdminClient();

    const { data: loan, error: fetchError } = await admin
      .from('loans')
      .select('id, user_id, status, requested_amount, interest_rate, disbursed_at')
      .eq('id', id)
      .maybeSingle();

    if (fetchError || !loan) {
      return NextResponse.json({ error: 'Préstamo no encontrado' }, { status: 404 });
    }
    if (loan.user_id !== user.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }
    if (loan.status !== 'draft') {
      return NextResponse.json({ error: 'Solo se puede editar el plan en estado borrador' }, { status: 409 });
    }

    // Draft loans have no disbursement yet: today in Bogota is the proxy.
    const disbursedOn = hoyBogota(loan.disbursed_at ? new Date(loan.disbursed_at) : new Date());

    // RN-4.3: without a new term, keep the last month of the stored plan.
    let lastMonth: FechaISO | undefined;
    if (months === undefined) {
      const { data: storedRows } = await admin
        .from('loan_payment_plan_items')
        .select('due_date, capital_amount')
        .eq('loan_id', id);
      const agreed = agreedPlanFromRows(storedRows ?? []);
      if (!agreed.ok) {
        return NextResponse.json({ error: agreed.error.mensaje }, { status: 422 });
      }
      lastMonth = agreed.value.lastMonth;
    }

    // RN-4.3 (chosen term, up to the maximum) and RN-4.26 (free capital). A
    // missing or invalid loan rate is reported (422), never replaced by 2%.
    // RN-4.3b: editing the request rejects past months (capital or term end).
    const plan = buildPaymentPlan({
      requestedAmount: Number(loan.requested_amount),
      rate: loan.interest_rate,
      disbursedOn,
      months,
      lastMonth,
      capitalOverrides: capital_overrides,
      requesting: true,
    });
    if (!plan.ok) {
      return NextResponse.json({ error: plan.error.mensaje }, { status: 422 });
    }
    const planRows = plan.value;

    // Reemplazar el plan existente
    await admin.from('loan_payment_plan_items').delete().eq('loan_id', id);

    if (planRows.length > 0) {
      await admin
        .from('loan_payment_plan_items')
        .insert(planRows.map((r) => ({ ...r, loan_id: id })));
    }

    // Actualizar meses en el préstamo
    await admin
      .from('loans')
      .update({ payment_plan_months: planRows.length, updated_at: new Date().toISOString() })
      .eq('id', id);

    return NextResponse.json({ plan: planRows });
  } catch (err) {
    console.error('API Error PUT /api/prestamos/[id]:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
