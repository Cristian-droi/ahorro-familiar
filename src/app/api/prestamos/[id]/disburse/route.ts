import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { agreedPlanFromRows, buildPaymentPlan } from '@/lib/loans';
import { EXPIRED_REQUEST_MESSAGE, expireLoanRequestIfDue } from '@/lib/loan-expiry';
import { desembolsoDePrestamo, getAjustesDePrestamo, getTasaCuatroPorMil } from '@/lib/loan-settings';
import { disburseSchema, deductionsDetailSchema } from '@/lib/schemas/loan';
import { getCashBalance } from '@/lib/data/loans';
import { getOpenPeriodShareValue } from '@/lib/data/share-value';
import { validarPuedeComprar } from '@/modules/acciones/domain/valor-de-accion';
import { buildDisbursementReceipt, disburseLoan } from '@/lib/disbursement';
import { mesAplicado } from '@/modules/prestamos/domain/calendario';
import { hoyBogota } from '@/shared/domain/fechas';

// POST /api/prestamos/[id]/disburse — admin realiza el desembolso del préstamo.
// Requisitos:
//   - Préstamo en pending_disbursement
//   - disbursement_proof_path: comprobante de transferencia (requerido)
//   - Si loan_shares_paid_upfront=true: debe existir un recibo aprobado de acciones_prestamo para este préstamo
// Al desembolsar:
//   - Se calcula el monto real desembolsado
//   - Se actualiza outstanding_balance = requested_amount
//   - Se recalcula el plan de pagos con la fecha real de desembolso
//   - El préstamo queda active, con su CE en cash_outflows y su registro en audit_log
//   - Si loan_shares_paid_upfront=false y loan_shares_amount>0, o si tiene deduct_obligations=true:
//       Se crea automáticamente un único recibo aprobado con los ítems correspondientes.
//   - Todo se escribe en una sola transacción (RN-4.17): RPC desembolsar_prestamo.
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
      const errorMsg = parsed.error.issues[0]?.message ?? 'Datos de desembolso inválidos';
      return NextResponse.json(
        { error: errorMsg },
        { status: 400 },
      );
    }
    const { disbursement_proof_path, payment_method } = parsed.data;

    const admin = createSupabaseAdminClient();

    const { data: loan, error: fetchError } = await admin
      .from('loans')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchError || !loan) {
      return NextResponse.json({ error: 'Préstamo no encontrado' }, { status: 404 });
    }
    // RN-4.5b: an expired request is annulled instead of disbursed.
    if (await expireLoanRequestIfDue(admin, loan)) {
      return NextResponse.json({ error: EXPIRED_REQUEST_MESSAGE }, { status: 409 });
    }
    if (loan.status !== 'pending_disbursement') {
      return NextResponse.json({ error: `El préstamo no está listo para desembolso (estado: ${loan.status})` }, { status: 409 });
    }

    // Validate the stored deductions before touching any money, so a malformed
    // detail aborts the disbursement instead of leaving it half-applied.
    const parsedDeductions = deductionsDetailSchema.safeParse(
      loan.deduct_obligations ? (loan.deductions_detail ?? []) : [],
    );
    if (!parsedDeductions.success) {
      console.error('disburse: deductions_detail inválido', parsedDeductions.error.issues);
      return NextResponse.json({ error: 'El detalle de deducciones del préstamo es inválido' }, { status: 422 });
    }
    const deductionsDetail = parsedDeductions.data;

    // Validación de saldo en caja: bloqueamos el desembolso si la caja no
    // alcanza a cubrir el monto neto que vamos a entregar. Usamos el mismo
    // get_cash_balance() que pinta el Libro de caja — así admin y sistema
    // hablan del mismo número.
    // RN-4.16: el 4x1000 se calcula sobre el neto que sale de la caja, después
    // de las deducciones (acciones por préstamo, multas, intereses y capital).
    const desembolso = desembolsoDePrestamo({
      monto: Number(loan.requested_amount),
      accionesPorPrestamo: Number(loan.loan_shares_amount || 0),
      pagadasPorAdelantado: Boolean(loan.loan_shares_paid_upfront),
      accionesVencidas: loan.deduct_obligations ? Number(loan.deducted_shares_amount || 0) : 0,
      multas: loan.deduct_obligations ? Number(loan.deducted_fines_amount || 0) : 0,
      intereses: loan.deduct_obligations ? Number(loan.deducted_interest_amount || 0) : 0,
      capital: loan.deduct_obligations ? Number(loan.deducted_capital_amount || 0) : 0,
      tasaPorMil: await getTasaCuatroPorMil(admin),
    });
    if (!desembolso.ok) {
      return NextResponse.json({ error: desembolso.error.mensaje }, { status: 422 });
    }
    const netAmount = desembolso.value.seTransfiere;
    const fourPerThousand = desembolso.value.cuatroPorMil;

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

    const disbursedAt = new Date();
    const disbursedAmount = netAmount;

    // Recalcular plan de pagos con la fecha real de desembolso (RN-4.3b): el
    // plan pactado se rehace por mes calendario, con el mismo último mes del
    // plazo; el capital de un mes que quedó antes del mes aplicado pasa al
    // primer mes, y si todo el plazo quedó atrás, todo el capital va en el mes
    // aplicado. Una tasa inválida del préstamo se reporta, no se cambia por 2%.
    const { data: planItems } = await admin
      .from('loan_payment_plan_items')
      .select('due_date, capital_amount')
      .eq('loan_id', id);

    const agreed = agreedPlanFromRows(planItems ?? []);
    if (!agreed.ok) {
      return NextResponse.json({ error: agreed.error.mensaje }, { status: 422 });
    }

    // RN-4.20, RN-4.21 and RN-4.3 ⚙️. RN-4.21b: the days in force today are
    // the ones this loan keeps; they are stored with disbursed_at.
    const ajustes = await getAjustesDePrestamo(admin);
    const disbursedOn = hoyBogota(disbursedAt);
    const plan = buildPaymentPlan({
      requestedAmount: Number(loan.requested_amount),
      rate: loan.interest_rate,
      disbursedOn,
      lastMonth: agreed.value.lastMonth,
      capitalOverrides: agreed.value.capitalOverrides,
      ajustes,
    });
    if (!plan.ok) {
      return NextResponse.json({ error: plan.error.mensaje }, { status: 422 });
    }

    // RN-4.14: shares not paid upfront are discounted here, in the same receipt
    // as the deducted obligations. A missing share value keeps unit_value null.
    let unitValue: number | null = null;
    if (!loan.loan_shares_paid_upfront && Number(loan.loan_shares_amount) > 0) {
      try {
        const puedeComprar = validarPuedeComprar({ valorDeAccion: await getOpenPeriodShareValue(admin, loan.user_id) });
        unitValue = puedeComprar.ok ? puedeComprar.value : null;
      } catch (shareValueErr) {
        console.error('disburse: no se pudo leer el valor de acción del periodo', shareValueErr);
      }
    }
    const receipt = buildDisbursementReceipt({
      loanId: id,
      loanSharesAmount: Number(loan.loan_shares_amount || 0),
      loanSharesCount: loan.loan_shares_count != null ? Number(loan.loan_shares_count) : null,
      loanSharesPaidUpfront: Boolean(loan.loan_shares_paid_upfront),
      deductions: deductionsDetail,
      unitValue,
      disbursedAt,
    });

    // RN-4.17: one transaction. It also blocks unpaid upfront shares (RN-4.14)
    // and a short cash box (RN-4.9) inside the database.
    const result = await disburseLoan(admin, {
      loanId: id,
      actorId: authCheck.user.id,
      disbursement: {
        disbursed_amount: disbursedAmount,
        four_per_thousand: fourPerThousand,
        disbursed_at: disbursedAt.toISOString(),
        full_rate_day_limit: ajustes.diaLimiteTasaCompleta,
        cutoff_day: ajustes.diaDeCorte,
        disbursement_proof_path: payment_method === 'cash' ? 'cash' : (disbursement_proof_path ?? null),
        payment_method,
        applied_month: mesAplicado(disbursedOn, ajustes.diaDeCorte),
        interest_paid_month: receipt.interestPaidMonth,
      },
      plan: plan.value,
      receiptItems: receipt.items,
    });
    if (!result.ok) {
      if (result.status === 500) {
        console.error('disburse: la RPC desembolsar_prestamo falló', result.message);
        return NextResponse.json({ error: 'No se pudo registrar el desembolso' }, { status: 500 });
      }
      return NextResponse.json({ error: result.message, code: result.code }, { status: result.status });
    }

    return NextResponse.json({ success: true, disbursed_amount: disbursedAmount, ce_number: result.ceNumber });
  } catch (err) {
    console.error('API Error POST /api/prestamos/[id]/disburse:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
