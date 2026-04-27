import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { calcDisbursedAmount, buildPaymentPlan } from '@/lib/loans';
import { disburseSchema } from '@/lib/schemas/loan';
import { getCashBalance } from '@/lib/data/loans';

// POST /api/prestamos/[id]/disburse — admin realiza el desembolso del préstamo.
// Requisitos:
//   - Préstamo en pending_disbursement
//   - disbursement_proof_path: comprobante de transferencia (requerido)
//   - Si loan_shares_paid_upfront=true: debe existir un recibo aprobado de acciones_prestamo para este préstamo
// Al desembolsar:
//   - Se calcula el monto real desembolsado
//   - Se actualiza outstanding_balance = requested_amount
//   - Se recalcula el plan de pagos con la fecha real de desembolso
//   - El trigger assigns CE- number automáticamente
//   - El préstamo queda active
//   - Si loan_shares_paid_upfront=false y loan_shares_amount>0:
//       Se crea automáticamente un recibo aprobado con un item
//       acciones_prestamo por el monto descontado, ligado al loan_id.
//       Es contable (no entra cash); get_cash_balance() lo neutraliza.
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

    const body = await request.json().catch(() => ({}));
    const parsed = disburseSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Se requiere el comprobante de transferencia (disbursement_proof_path)' },
        { status: 400 },
      );
    }
    const { disbursement_proof_path } = parsed.data;

    const admin = createSupabaseAdminClient();

    const { data: loan, error: fetchError } = await admin
      .from('loans')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchError || !loan) {
      return NextResponse.json({ error: 'Préstamo no encontrado' }, { status: 404 });
    }
    if (loan.status !== 'pending_disbursement') {
      return NextResponse.json({ error: `El préstamo no está listo para desembolso (estado: ${loan.status})` }, { status: 409 });
    }

    // Validación de saldo en caja: bloqueamos el desembolso si la caja no
    // alcanza a cubrir el monto neto que vamos a entregar (requested_amount
    // menos acciones pagadas upfront y 4x1000 si corresponde). Usamos el
    // mismo get_cash_balance() que pinta el Libro de caja — así admin y
    // sistema hablan del mismo número.
    const netAmount = calcDisbursedAmount(
      Number(loan.requested_amount),
      Number(loan.loan_shares_amount),
      Boolean(loan.loan_shares_paid_upfront),
      Number(loan.four_per_thousand),
    );

    const cashBalance = await getCashBalance(admin).catch((err) => {
      console.error('disburse: fallo al leer cash balance', err);
      return null;
    });
    if (cashBalance !== null && netAmount > cashBalance) {
      return NextResponse.json(
        {
          error: 'El saldo en caja no alcanza para desembolsar este préstamo.',
          details: `Caja actual: ${cashBalance}. Monto a desembolsar: ${netAmount}.`,
          cash_balance: cashBalance,
          required_amount: netAmount,
          code: 'insufficient_cash_balance',
        },
        { status: 422 },
      );
    }

    // Si el accionista eligió pagar acciones por adelantado, verificar que lo hizo
    if (loan.loan_shares_paid_upfront) {
      const { data: upfrontItems } = await admin
        .from('receipt_items')
        .select('id, receipts!inner(status)')
        .eq('concept', 'acciones_prestamo')
        .eq('loan_id', id);

      const paid = (upfrontItems ?? []).some(
        (item) => (item as Record<string, unknown> & { receipts: { status: string } }).receipts?.status === 'approved',
      );

      if (!paid) {
        return NextResponse.json(
          { error: 'El accionista eligió pagar las acciones por adelantado. El recibo de acciones por préstamo aún no está aprobado.' },
          { status: 422 },
        );
      }
    }

    const disbursedAt = new Date();
    const disbursedAmount = netAmount;

    // Recalcular plan de pagos con la fecha real de desembolso
    const { data: planItems } = await admin
      .from('loan_payment_plan_items')
      .select('month_number, capital_amount')
      .eq('loan_id', id)
      .order('month_number');

    const capitalOverrides: Record<number, number> = {};
    for (const item of planItems ?? []) {
      capitalOverrides[item.month_number] = Number(item.capital_amount);
    }

    const planRows = buildPaymentPlan({
      requestedAmount: Number(loan.requested_amount),
      months: loan.payment_plan_months ?? 12,
      rate: Number(loan.interest_rate),
      disbursedAt,
      capitalOverrides,
    });

    // Actualizar préstamo (el trigger assign_disbursement_number asigna CE- automáticamente)
    const { error: updateError } = await admin
      .from('loans')
      .update({
        status: 'active',
        disbursed_amount: disbursedAmount,
        disbursed_at: disbursedAt.toISOString(),
        outstanding_balance: loan.requested_amount,
        disbursement_proof_path,
        updated_at: disbursedAt.toISOString(),
      })
      .eq('id', id);

    if (updateError) {
      return NextResponse.json({ error: 'No se pudo actualizar el préstamo' }, { status: 500 });
    }

    // Reemplazar el plan con las fechas reales
    await admin.from('loan_payment_plan_items').delete().eq('loan_id', id);
    if (planRows.length > 0) {
      await admin
        .from('loan_payment_plan_items')
        .insert(planRows.map((r) => ({ ...r, loan_id: id })));
    }

    // ====================================================================
    // Acciones por préstamo descontadas — generar recibo automático.
    //
    // Cuando el accionista eligió "descuento al desembolso" (no upfront),
    // las acciones por préstamo NO entraron al fondo como un recibo CI
    // separado sino que se descuentan del monto que se le entrega ahora.
    // Para que esas acciones queden registradas como movimiento del
    // accionista (visibles en su extracto y como item del CE expandido),
    // creamos automáticamente un recibo aprobado con un item
    // 'acciones_prestamo' ligado a este loan.
    //
    // Importante: este recibo NO representa cash real entrante. La
    // función get_cash_balance() lo neutraliza filtrando por
    // loan_shares_paid_upfront = false + loan_id NOT NULL.
    // ====================================================================
    const loanSharesAmount = Number(loan.loan_shares_amount);
    if (!loan.loan_shares_paid_upfront && loanSharesAmount > 0) {
      // Traemos el valor de acción del socio para poblar share_count/unit_value.
      // Si no está, dejamos amount sin desglose por acciones (es válido para
      // este concepto: el constraint receipt_items_acciones_shape solo aplica
      // a concept = 'acciones').
      const { data: borrowerProfile } = await admin
        .from('profiles')
        .select('selected_share_value')
        .eq('id', loan.user_id)
        .maybeSingle();
      const unitValue =
        borrowerProfile?.selected_share_value != null
          ? Number(borrowerProfile.selected_share_value)
          : null;

      // target_month = primer día del mes del desembolso (constraint del schema).
      const yyyy = disbursedAt.getFullYear();
      const mm = String(disbursedAt.getMonth() + 1).padStart(2, '0');
      const targetMonth = `${yyyy}-${mm}-01`;

      const { data: createdReceipt, error: receiptErr } = await admin
        .from('receipts')
        .insert({
          user_id: loan.user_id,
          status: 'approved',
          submitted_at: disbursedAt.toISOString(),
          reviewed_at: disbursedAt.toISOString(),
          reviewed_by: authCheck.user.id,
          total_amount: loanSharesAmount,
        })
        .select('id')
        .single();

      if (receiptErr || !createdReceipt) {
        console.error('disburse: no se pudo crear el recibo de acciones_prestamo', receiptErr);
        // No bloqueamos el desembolso: el préstamo ya quedó active. Lo logueamos
        // para que el admin pueda crear el recibo manualmente si hace falta.
      } else {
        // share_count y unit_value son opcionales para 'acciones_prestamo'.
        // El constraint del schema exige share_count > 0 si se pasa, así que
        // mandamos null cuando no hay un valor positivo válido.
        const sharesCount =
          loan.loan_shares_count != null && Number(loan.loan_shares_count) > 0
            ? Number(loan.loan_shares_count)
            : null;
        const { error: itemErr } = await admin.from('receipt_items').insert({
          receipt_id: createdReceipt.id,
          concept: 'acciones_prestamo',
          target_month: targetMonth,
          share_count: sharesCount,
          unit_value: sharesCount != null ? unitValue : null,
          amount: loanSharesAmount,
          loan_id: id,
          auto_generated: false,
        });
        if (itemErr) {
          console.error('disburse: no se pudo crear el item de acciones_prestamo', itemErr);
        }
      }
    }

    return NextResponse.json({ success: true, disbursed_amount: disbursedAmount });
  } catch (err) {
    console.error('API Error POST /api/prestamos/[id]/disburse:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
