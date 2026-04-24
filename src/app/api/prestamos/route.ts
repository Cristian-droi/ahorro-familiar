import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createLoanSchema } from '@/lib/schemas/loan';
import { calcLoanShares, calcFourPerThousand, buildPaymentPlan } from '@/lib/loans';
import { getProfile } from '@/lib/data/profiles';

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
    const { requested_amount, payment_plan_months, loan_shares_paid_upfront } = parsed.data;

    const admin = createSupabaseAdminClient();

    // Obtener perfil para valor de acción
    const profile = await getProfile(admin, user.id);
    if (!profile.selected_share_value) {
      return NextResponse.json({ error: 'Debes definir tu valor de acción antes de solicitar un préstamo' }, { status: 422 });
    }

    // Leer tasa de interés vigente
    const { data: rateSetting } = await admin
      .from('system_settings')
      .select('value')
      .eq('key', 'loan_interest_rate')
      .maybeSingle();
    const interestRate = rateSetting ? Number(rateSetting.value) : 0.02;

    // Calcular valores del préstamo
    const { count: sharesCount, amount: sharesAmount } = calcLoanShares(
      requested_amount,
      profile.selected_share_value,
    );
    const fourPerThousand = calcFourPerThousand(requested_amount);

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
