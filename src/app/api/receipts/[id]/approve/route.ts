import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

// POST /api/receipts/[id]/approve — aprobación por parte del admin.
//
// Pasa el recibo a 'approved' y registra reviewed_at/reviewed_by. El trigger
// `lock_share_value_on_approval` congela share_value_change_allowed del
// accionista si es la primera vez que aprueba un concepto 'acciones'.
//
// Si el recibo tiene ítems ligados a préstamos (loan_id != null):
//   - pago_capital  → descuenta del outstanding_balance del préstamo
//   - pago_intereses → actualiza last_interest_payment_date del préstamo
// Regla: para aprobar pago_capital de un préstamo, los intereses deben estar al día.

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: receiptId } = await params;

    const authCheck = await requireAdmin();
    if ('error' in authCheck) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status },
      );
    }
    const { user: admin_user } = authCheck;

    const admin = createSupabaseAdminClient();

    const { data: receipt, error: fetchError } = await admin
      .from('receipts')
      .select('id, status, user_id')
      .eq('id', receiptId)
      .maybeSingle();

    if (fetchError) {
      console.error('Error leyendo recibo:', fetchError);
      return NextResponse.json(
        { error: 'No se pudo leer el recibo' },
        { status: 500 },
      );
    }
    if (!receipt) {
      return NextResponse.json({ error: 'Recibo no encontrado' }, { status: 404 });
    }
    if (receipt.status !== 'pending') {
      return NextResponse.json(
        { error: `El recibo ya está ${receipt.status}` },
        { status: 409 },
      );
    }

    // Obtener ítems del recibo
    const { data: items } = await admin
      .from('receipt_items')
      .select('*')
      .eq('receipt_id', receiptId);

    const loanItems = (items ?? []).filter(
      (item) => item.loan_id != null && (item.concept === 'pago_capital' || item.concept === 'pago_intereses'),
    );

    // Validar: si hay pagos de capital, verificar que los intereses estén al día
    const capitalItems = loanItems.filter((i) => i.concept === 'pago_capital');
    for (const ci of capitalItems) {
      const { data: loan } = await admin
        .from('loans')
        .select('outstanding_balance, interest_rate, disbursed_at, last_interest_payment_date')
        .eq('id', ci.loan_id)
        .maybeSingle();

      if (loan && loan.disbursed_at) {
        const from = loan.last_interest_payment_date
          ? new Date(loan.last_interest_payment_date)
          : new Date(loan.disbursed_at);
        const now = new Date();
        const months =
          (now.getFullYear() - from.getFullYear()) * 12 +
          (now.getMonth() - from.getMonth());

        if (months > 0) {
          return NextResponse.json(
            {
              error:
                'No se puede aprobar el pago de capital. El accionista tiene intereses pendientes en este préstamo que deben pagarse primero.',
            },
            { status: 422 },
          );
        }
      }
    }

    // Aprobar el recibo
    const { error: updateError } = await admin
      .from('receipts')
      .update({
        status: 'approved',
        reviewed_at: new Date().toISOString(),
        reviewed_by: admin_user.id,
        rejection_reason: null,
        rejection_note: null,
      })
      .eq('id', receiptId);

    if (updateError) {
      console.error('Error aprobando recibo:', updateError);
      return NextResponse.json(
        { error: 'No se pudo aprobar el recibo' },
        { status: 500 },
      );
    }

    // Post-aprobación: actualizar préstamos afectados
    for (const item of loanItems) {
      if (item.concept === 'pago_capital') {
        // Descontar del saldo del préstamo
        const { data: loan } = await admin
          .from('loans')
          .select('outstanding_balance')
          .eq('id', item.loan_id)
          .maybeSingle();

        if (loan) {
          const newBalance = Math.max(0, Number(loan.outstanding_balance) - Number(item.amount));
          await admin
            .from('loans')
            .update({
              outstanding_balance: newBalance,
              status: newBalance === 0 ? 'paid' : undefined,
              updated_at: new Date().toISOString(),
            })
            .eq('id', item.loan_id);
        }
      } else if (item.concept === 'pago_intereses') {
        // Marcar hasta qué fecha están pagados los intereses (primer día del mes actual)
        const today = new Date();
        const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
          .toISOString()
          .split('T')[0];
        await admin
          .from('loans')
          .update({
            last_interest_payment_date: firstOfMonth,
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.loan_id);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('API Error POST /api/receipts/[id]/approve:', err);
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 },
    );
  }
}
