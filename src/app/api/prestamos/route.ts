import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createLoanSchema } from '@/lib/schemas/loan';
import { buildPaymentPlan } from '@/lib/loans';
import {
  accionesPorPrestamo,
  desembolsoDePrestamo,
  getTasaCuatroPorMil,
  tasaDeInteresGlobalDesdeAjuste,
} from '@/lib/loan-settings';
import { getOpenPeriodShareValue } from '@/lib/data/share-value';
import { validarPuedeComprar } from '@/modules/acciones/domain/valor-de-accion';
import { checkUserObligations } from '@/lib/obligations';
import { hoyBogota } from '@/shared/domain/fechas';

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

    // RN-4.18: the global setting falls back to the default 2% when missing or invalid.
    const rateVal = settingsMap.get('default_loan_interest_rate') ?? settingsMap.get('loan_interest_rate');
    const interestRate = tasaDeInteresGlobalDesdeAjuste(rateVal);

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

    // Valor de acción del periodo abierto (RN-2.3)
    const puedeComprar = validarPuedeComprar({
      valorDeAccion: await getOpenPeriodShareValue(admin, user.id),
    });
    if (!puedeComprar.ok) {
      return NextResponse.json({ error: puedeComprar.error.mensaje }, { status: 400 });
    }

    // Calcular valores de acciones asociadas al préstamo (RN-4.10)
    const acciones = accionesPorPrestamo(requested_amount, puedeComprar.value);
    if (!acciones.ok) {
      return NextResponse.json({ error: acciones.error.mensaje }, { status: 400 });
    }
    const { cantidad: sharesCount, valor: sharesAmount } = acciones.value;

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

    // RN-4.16: 4x1000 sobre el neto que sale de la caja, después de las deducciones.
    const desembolso = desembolsoDePrestamo({
      monto: requested_amount,
      accionesPorPrestamo: sharesAmount,
      pagadasPorAdelantado: loan_shares_paid_upfront,
      accionesVencidas: deductedShares,
      multas: deductedFines,
      intereses: deductedInterest,
      capital: deductedCapital,
      tasaPorMil: await getTasaCuatroPorMil(admin),
    });
    if (!desembolso.ok) {
      return NextResponse.json({ error: desembolso.error.mensaje }, { status: 422 });
    }
    const fourPerThousand = desembolso.value.cuatroPorMil;

    // Plan de pagos con la fecha de hoy en Bogotá como proxy del desembolso.
    // RN-4.3: el plazo lo elige el accionista, con máximo hasta diciembre (si no
    // lo envía, se usa el máximo). Se rehace por mes calendario al desembolsar.
    const plan = buildPaymentPlan({
      requestedAmount: requested_amount,
      rate: interestRate,
      disbursedOn: hoyBogota(new Date()),
      months: payment_plan_months,
    });
    if (!plan.ok) {
      return NextResponse.json({ error: plan.error.mensaje }, { status: 422 });
    }
    const planRows = plan.value;

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
        payment_plan_months: planRows.length,
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
