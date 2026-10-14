import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createLoanSchema } from '@/lib/schemas/loan';
import { calcLoanShares, buildPaymentPlan, calcLoanDeductionsAndNet } from '@/lib/loans';
import { getProfile } from '@/lib/data/profiles';
import { checkUserObligations } from '@/lib/obligations';

// POST /api/prestamos — accionista crea un borrador de préstamo.
export async function POST(request: Request) {
  try {
    const auth = await requireUser();
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { user } = auth;

    const body = await request.json();
    const parsed = createLoanSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 400 });
    }
    const { requested_amount, payment_plan_months, loan_shares_paid_upfront, deduct_obligations, deducted_capital_amount, deductions_detail } = parsed.data;

    const admin = createSupabaseAdminClient();

    // Validar obligaciones pendientes del usuario
    const obligations = await checkUserObligations(admin, user.id);
    if (!deduct_obligations && !obligations.isUpToDate) {
      return NextResponse.json({
        error: 'No podés solicitar un préstamo si tenés obligaciones pendientes.',
        reasons: obligations.reasons,
      }, { status: 422 });
    }

    // Cargar configuraciones de préstamos desde system_settings
    const { data: settingsRes } = await admin
      .from('system_settings')
      .select('key, value')
      .in('key', ['default_loan_interest_rate', 'loan_interest_rate', 'max_active_loans_enabled', 'max_active_loans_per_user']);

    const settingsMap = new Map((settingsRes || []).map(s => [s.key, s.value]));
    const maxLoansEnabled = settingsMap.has('max_active_loans_enabled') ? Boolean(settingsMap.get('max_active_loans_enabled')) : true;
    const maxLoansPerUser = settingsMap.has('max_active_loans_per_user') ? Number(settingsMap.get('max_active_loans_per_user')) : 2;

    const rateVal = settingsMap.get('default_loan_interest_rate') ?? settingsMap.get('loan_interest_rate');
    const interestRate = rateVal != null ? Number(rateVal) : 0.02;

    // Verificar límite de préstamos activos si la restricción está activada
    if (maxLoansEnabled) {
      const { count: activeLoansCount } = await admin
        .from('loans')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'active');

      if ((activeLoansCount || 0) >= maxLoansPerUser) {
        return NextResponse.json({
          error: `Ya tenés ${activeLoansCount} préstamos activos. El límite máximo permitido por la administración es de ${maxLoansPerUser}.`
        }, { status: 422 });
      }
    }

    // Obtener perfil para valor de acción
    const profile = await getProfile(admin, user.id);
    if (!profile.selected_share_value) {
      return NextResponse.json({ error: 'Debes definir tu valor de acción antes de solicitar un préstamo' }, { status: 422 });
    }

    // Calcular valores de acciones asociadas al préstamo
    const { count: sharesCount, amount: sharesAmount } = calcLoanShares(
      requested_amount,
      profile.selected_share_value,
    );

    let deductedShares = 0;
    let deductedFines = 0;
    let deductedInterest = 0;
    let deductedCapital = 0;

    if (deduct_obligations) {
      deductedShares = obligations.sharesOwedAmount;
      deductedFines = obligations.finesOwedAmount;
      deductedInterest = obligations.interestOwedAmount;
      deductedCapital = deducted_capital_amount;

      // Validar abonos a capital contra saldos de préstamos activos
      for (const detail of deductions_detail || []) {
        if (detail.concept === 'pago_capital') {
          const activeLoan = obligations.activeLoansDetails.find(l => l.loanId === detail.loan_id);
          if (!activeLoan) {
            return NextResponse.json({ error: `El préstamo ${detail.loan_id} no está activo o no pertenece al usuario` }, { status: 422 });
          }
          if (detail.amount > activeLoan.outstandingBalance) {
            return NextResponse.json({ error: `El abono a capital del préstamo ${detail.disbursementNumber || activeLoan.loanId} supera su capital pendiente` }, { status: 422 });
          }
        }
      }
    }

    const { netDisbursed, fourPerThousand } = calcLoanDeductionsAndNet({
      requestedAmount: requested_amount,
      sharesAmount,
      paidUpfront: loan_shares_paid_upfront,
      deductedShares,
      deductedFines,
      deductedInterest,
      deductedCapital,
    });

    if (deduct_obligations && netDisbursed < 0) {
      return NextResponse.json({ error: 'El neto a recibir no puede ser negativo.' }, { status: 422 });
    }

    // Crear el préstamo
    const { data: loan, error: loanError } = await admin
      .from('loans')
      .insert({
        user_id: user.id,
        requested_amount,
        interest_rate: interestRate,
        loan_shares_count: sharesCount,
        loan_shares_amount: sharesAmount,
        loan_shares_paid_upfront,
        four_per_thousand: fourPerThousand,
        outstanding_balance: 0,
        status: 'draft',
        payment_plan_months,
        deduct_obligations,
        deducted_shares_amount: deductedShares,
        deducted_fines_amount: deductedFines,
        deducted_interest_amount: deductedInterest,
        deducted_capital_amount: deductedCapital,
        deductions_detail,
      })
      .select()
      .single();

    if (loanError || !loan) {
      console.error('Error creando préstamo:', loanError);
      return NextResponse.json({ error: 'No se pudo crear el préstamo' }, { status: 500 });
    }

    // Generar plan de pagos por defecto (usando fecha actual como proxy de desembolso)
    const planRows = buildPaymentPlan({
      requestedAmount: requested_amount,
      months: payment_plan_months,
      rate: interestRate,
      disbursedAt: new Date(),
    });

    if (planRows.length > 0) {
      const planItems = planRows.map((r) => ({ ...r, loan_id: loan.id }));
      await admin.from('loan_payment_plan_items').insert(planItems);
    }

    return NextResponse.json({ loan }, { status: 201 });
  } catch (err) {
    console.error('API Error POST /api/prestamos:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
