import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { toggleUpfrontSharesSchema } from '@/lib/schemas/loan';

// PATCH /api/prestamos/[id]/toggle-upfront-shares
// Admin puede cambiar si las acciones por préstamo se pagan por adelantado o se descuentan del desembolso.
// Solo funciona mientras el préstamo está en pending_disbursement.
export async function PATCH(
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
    const parsed = toggleUpfrontSharesSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();

    const { data: loan, error: fetchError } = await admin
      .from('loans')
      .select('id, status')
      .eq('id', id)
      .maybeSingle();

    if (fetchError || !loan) {
      return NextResponse.json({ error: 'Préstamo no encontrado' }, { status: 404 });
    }
    if (loan.status !== 'pending_disbursement') {
      return NextResponse.json({ error: 'Solo se puede modificar esta opción cuando el préstamo está listo para desembolso' }, { status: 409 });
    }

    const { error: updateError } = await admin
      .from('loans')
      .update({
        loan_shares_paid_upfront: parsed.data.loan_shares_paid_upfront,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateError) {
      return NextResponse.json({ error: 'No se pudo actualizar la opción' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('API Error PATCH /api/prestamos/[id]/toggle-upfront-shares:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
