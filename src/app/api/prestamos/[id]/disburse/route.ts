import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { calcDisbursedAmount, buildPaymentPlan, calcLoanDeductionsAndNet } from '@/lib/loans';
import { disburseSchema, deductionsDetailSchema } from '@/lib/schemas/loan';
import { getCashBalance } from '@/lib/data/loans';
import type { Database } from '@/types/database';

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
//   - Si loan_shares_paid_upfront=false y loan_shares_amount>0, o si tiene deduct_obligations=true:
//       Se crea automáticamente un único recibo aprobado con los ítems correspondientes.
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

    // Cargar configuración del gravamen 4x1000 desde system_settings
    const { data: fptSetting } = await admin
      .from('system_settings')
      .select('value')
      .eq('key', 'four_per_thousand_rate')
      .maybeSingle();
    const fourPerThousandRate = fptSetting?.value != null ? Number(fptSetting.value) : 0.004;

    // Validación de saldo en caja: bloqueamos el desembolso si la caja no
    // alcanza a cubrir el monto neto que vamos a entregar (requested_amount
    // menos acciones pagadas upfront y 4x1000 si corresponde). Usamos el
    // mismo get_cash_balance() que pinta el Libro de caja — así admin y
    // sistema hablan del mismo número.
    const netAmount = loan.deduct_obligations
      ? calcLoanDeductionsAndNet({
          requestedAmount: Number(loan.requested_amount),
          sharesAmount: Number(loan.loan_shares_amount || 0),
          paidUpfront: Boolean(loan.loan_shares_paid_upfront),
          deductedShares: Number(loan.deducted_shares_amount || 0),
          deductedFines: Number(loan.deducted_fines_amount || 0),
          deductedInterest: Number(loan.deducted_interest_amount || 0),
          deductedCapital: Number(loan.deducted_capital_amount || 0),
          fourPerThousandRate,
        }).netDisbursed
      : calcDisbursedAmount(
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
        disbursement_proof_path: payment_method === 'cash' ? 'cash' : disbursement_proof_path,
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
    // Deducciones y Acciones por préstamo descontadas — generar recibo automático.
    //
    // Si el socio eligió deducir obligaciones o descontar las acciones por préstamo
    // al desembolso, creamos automáticamente un ÚNICO recibo.
    // Para que los triggers de base de datos se disparen correctamente (por ejemplo,
    // actualizando saldos de capital a través del trigger en update de status de receipts),
    // primero insertamos el recibo como 'pending', insertamos los ítems, y luego
    // lo actualizamos a 'approved'.
    // ====================================================================
    const loanSharesAmount = Number(loan.loan_shares_amount);
    const hasLoanSharesDeduction = !loan.loan_shares_paid_upfront && loanSharesAmount > 0;
    
    const deductedShares = Number(loan.deducted_shares_amount || 0);
    const deductedFines = Number(loan.deducted_fines_amount || 0);
    const deductedInterest = Number(loan.deducted_interest_amount || 0);
    const deductedCapital = Number(loan.deducted_capital_amount || 0);
    const totalDeductions = deductedShares + deductedFines + deductedInterest + deductedCapital;

    const totalReceiptAmount = totalDeductions + (hasLoanSharesDeduction ? loanSharesAmount : 0);

    if (totalReceiptAmount > 0) {
      const { data: createdReceipt, error: receiptErr } = await admin
        .from('receipts')
        .insert({
          user_id: loan.user_id,
          status: 'pending',
          submitted_at: disbursedAt.toISOString(),
          reviewed_at: null,
          reviewed_by: null,
          total_amount: 0, // el trigger de BD lo recalculará
          payment_method: payment_method,
        })
        .select('id')
        .single();

      if (receiptErr || !createdReceipt) {
        console.error('disburse: no se pudo crear el recibo de deducciones', receiptErr);
      } else {
        const itemsToInsert: Database['public']['Tables']['receipt_items']['Insert'][] = [];

        // A. Acciones por préstamo descontadas (acciones_prestamo)
        if (hasLoanSharesDeduction) {
          const { data: borrowerProfile } = await admin
            .from('profiles')
            .select('selected_share_value')
            .eq('id', loan.user_id)
            .maybeSingle();
          const unitValue = borrowerProfile?.selected_share_value != null ? Number(borrowerProfile.selected_share_value) : null;
          
          const yyyy = disbursedAt.getFullYear();
          const mm = String(disbursedAt.getMonth() + 1).padStart(2, '0');
          const targetMonth = `${yyyy}-${mm}-01`;
          const sharesCount = loan.loan_shares_count != null && Number(loan.loan_shares_count) > 0 ? Number(loan.loan_shares_count) : null;

          itemsToInsert.push({
            receipt_id: createdReceipt.id,
            concept: 'acciones_prestamo',
            target_month: targetMonth,
            share_count: sharesCount,
            unit_value: sharesCount != null ? unitValue : null,
            amount: loanSharesAmount,
            loan_id: id,
            auto_generated: false,
          });
        }

        // B. Deducciones de obligaciones y capital
        if (loan.deduct_obligations) {
          for (const detail of deductionsDetail) {
            itemsToInsert.push({
              receipt_id: createdReceipt.id,
              concept: detail.concept,
              target_month: detail.target_month,
              share_count: detail.share_count ?? null,
              unit_value: detail.unit_value ?? null,
              amount: detail.amount,
              loan_id: detail.loan_id ?? null,
              auto_generated: detail.concept === 'multa_acciones',
            });
          }
        }

        if (itemsToInsert.length > 0) {
          const { error: itemsErr } = await admin.from('receipt_items').insert(itemsToInsert);
          if (itemsErr) {
            console.error('disburse: no se pudieron crear los items del recibo de deducciones', itemsErr);
            await admin.from('receipts').delete().eq('id', createdReceipt.id);
          } else {
            // Actualizar a aprobado para disparar el trigger trg_apply_loan_payment
            const { error: approveErr } = await admin
              .from('receipts')
              .update({
                status: 'approved',
                reviewed_at: disbursedAt.toISOString(),
                reviewed_by: authCheck.user.id,
              })
              .eq('id', createdReceipt.id);

            if (approveErr) {
              console.error('disburse: no se pudo aprobar el recibo de deducciones', approveErr);
            } else {
              // Actualizar last_interest_payment_date de los préstamos cuyos intereses fueron descontados
              const interestPaymentDetails = itemsToInsert.filter(
                (it): it is typeof it & { loan_id: string } => it.concept === 'pago_intereses' && !!it.loan_id,
              );
              const firstOfMonth = new Date(disbursedAt.getFullYear(), disbursedAt.getMonth(), 1)
                .toISOString()
                .split('T')[0];

              for (const item of interestPaymentDetails) {
                const { error: updateInterestErr } = await admin
                  .from('loans')
                  .update({
                    last_interest_payment_date: firstOfMonth,
                    updated_at: disbursedAt.toISOString(),
                  })
                  .eq('id', item.loan_id);
                
                if (updateInterestErr) {
                  console.error(`disburse: no se pudo actualizar last_interest_payment_date para el préstamo ${item.loan_id}`, updateInterestErr);
                }
              }
            }
          }
        }
      }
    }

    return NextResponse.json({ success: true, disbursed_amount: disbursedAmount });
  } catch (err) {
    console.error('API Error POST /api/prestamos/[id]/disburse:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
