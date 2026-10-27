import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { checkUserObligations } from '@/lib/obligations';
import { desembolsoDePrestamo, getTasaCuatroPorMil } from '@/lib/loan-settings';
import { getBogotaCurrentMonth } from '@/lib/fines';
import { deductionsDetailSchema } from '@/lib/schemas/loan';
import type { DeductionDetail } from '@/types/entities';
import type { Json } from '@/types/database';

// POST /api/prestamos/[id]/submit — accionista envía el préstamo para revisión del admin.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireUser();
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { user } = auth;

    const admin = createSupabaseAdminClient();

    const { data: loan, error: fetchError } = await admin
      .from('loans')
      .select('id, user_id, status, payment_plan_months, requested_amount, loan_shares_amount, loan_shares_paid_upfront, deduct_obligations, deducted_capital_amount, deductions_detail, four_per_thousand')
      .eq('id', id)
      .maybeSingle();

    if (fetchError || !loan) {
      return NextResponse.json({ error: 'Préstamo no encontrado' }, { status: 404 });
    }
    if (loan.user_id !== user.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }
    if (loan.status !== 'draft') {
      return NextResponse.json({ error: 'Solo se puede enviar un préstamo en borrador' }, { status: 409 });
    }
    if (!loan.payment_plan_months) {
      return NextResponse.json({ error: 'Debes definir el plan de pagos antes de enviar' }, { status: 422 });
    }

    // Verificar que tenga al menos un ítem en el plan
    const { count } = await admin
      .from('loan_payment_plan_items')
      .select('id', { count: 'exact', head: true })
      .eq('loan_id', id);

    if (!count || count === 0) {
      return NextResponse.json({ error: 'El plan de pagos está vacío' }, { status: 422 });
    }

    // Validar obligaciones pendientes del usuario
    const obligations = await checkUserObligations(admin, user.id);
    if (!loan.deduct_obligations && !obligations.isUpToDate) {
      return NextResponse.json({
        error: 'No podés enviar esta solicitud si tenés obligaciones pendientes.',
        reasons: obligations.reasons,
      }, { status: 422 });
    }

    let deductedShares = 0;
    let deductedFines = 0;
    let deductedInterest = 0;
    let deductedCapital = 0;
    let finalFourPerThousand = Number(loan.four_per_thousand || 0);
    let finalDeductionsDetail: Json = loan.deductions_detail || [];

    if (loan.deduct_obligations) {
      deductedShares = obligations.sharesOwedAmount;
      deductedFines = obligations.finesOwedAmount;
      deductedInterest = obligations.interestOwedAmount;
      deductedCapital = Number(loan.deducted_capital_amount || 0);

      const currentMonthStr = getBogotaCurrentMonth();
      const parsedDetail = deductionsDetailSchema.safeParse(loan.deductions_detail ?? []);
      if (!parsedDetail.success) {
        console.error('submit: deductions_detail inválido', parsedDetail.error.issues);
        return NextResponse.json({ error: 'El detalle de deducciones del préstamo es inválido' }, { status: 422 });
      }
      const deductionsDetailList = parsedDetail.data;
      const capitalDetails = deductionsDetailList.filter(
        (d) => d.concept === 'pago_capital'
      );
      
      const newDeductionsDetail: DeductionDetail[] = [];
      
      // 1. Acciones vencidas y multas
      for (const o of obligations.overdueMonthsDetails) {
        // Without a chosen share value (RN-2.3) only the fine is deducted.
        if (o.sharesOwed > 0 && o.shareValue > 0) {
          newDeductionsDetail.push({
            concept: 'acciones',
            target_month: o.month,
            share_count: o.sharesOwed,
            unit_value: o.shareValue,
            amount: o.sharesOwed * o.shareValue,
          });
        }
        if (o.fineOwed > 0) {
          newDeductionsDetail.push({
            concept: 'multa_acciones',
            target_month: o.month,
            amount: o.fineOwed,
          });
        }
      }

      // 2. Intereses
      for (const l of obligations.activeLoansDetails) {
        if (l.interestOwed > 0) {
          newDeductionsDetail.push({
            concept: 'pago_intereses',
            target_month: currentMonthStr,
            amount: l.interestOwed,
            loan_id: l.loanId,
            disbursementNumber: l.disbursementNumber,
          });
        }
      }

      // 3. Capital (preservados)
      for (const cap of capitalDetails) {
        newDeductionsDetail.push(cap);
      }

      finalDeductionsDetail = newDeductionsDetail;

      // Validar abonos a capital contra saldos de préstamos activos
      for (const detail of newDeductionsDetail) {
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

      // RN-4.16: 4x1000 sobre el neto que sale de la caja, después de las deducciones.
      const desembolso = desembolsoDePrestamo({
        monto: Number(loan.requested_amount),
        accionesPorPrestamo: Number(loan.loan_shares_amount || 0),
        pagadasPorAdelantado: !!loan.loan_shares_paid_upfront,
        accionesVencidas: deductedShares,
        multas: deductedFines,
        intereses: deductedInterest,
        capital: deductedCapital,
        tasaPorMil: await getTasaCuatroPorMil(admin),
      });
      if (!desembolso.ok) {
        return NextResponse.json({ error: desembolso.error.mensaje }, { status: 422 });
      }

      finalFourPerThousand = desembolso.value.cuatroPorMil;
    }

    const { error: updateError } = await admin
      .from('loans')
      .update({
        status: 'pending_review',
        plan_status: null,
        deducted_shares_amount: deductedShares,
        deducted_fines_amount: deductedFines,
        deducted_interest_amount: deductedInterest,
        deductions_detail: finalDeductionsDetail,
        four_per_thousand: finalFourPerThousand,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (updateError) {
      return NextResponse.json({ error: 'No se pudo enviar el préstamo' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('API Error POST /api/prestamos/[id]/submit:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
