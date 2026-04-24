import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { updatePaymentPlanSchema } from '@/lib/schemas/loan';
import { buildPaymentPlan } from '@/lib/loans';

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
      return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
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

    const disbursedAt = loan.disbursed_at ? new Date(loan.disbursed_at) : new Date();

    const overrides: Record<number, number> = {};
    for (const [k, v] of Object.entries(capital_overrides)) {
      overrides[Number(k)] = Number(v);
    }

    const planRows = buildPaymentPlan({
      requestedAmount: Number(loan.requested_amount),
      months,
      rate: Number(loan.interest_rate),
      disbursedAt,
      capitalOverrides: overrides,
    });

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
      .update({ payment_plan_months: months, updated_at: new Date().toISOString() })
      .eq('id', id);

    return NextResponse.json({ plan: planRows });
  } catch (err) {
    console.error('API Error PUT /api/prestamos/[id]:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
