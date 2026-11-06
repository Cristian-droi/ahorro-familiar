import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { sumarAbonosPorPrestamo, validarAbonoACapital } from '@/modules/prestamos/domain/pagos';
import { err, ok, type ErrorDeDominio, type Result } from '@/shared/domain/result';

type ReceiptLine = { concept: string; loan_id?: string | null; amount?: number | null };

// RN-4.29: reads each loan's balance and applies the domain rule to the capital
// lines of a receipt. A loan that does not exist is left to the database trigger,
// which already answers `loan_not_found`.
//
// `countPending`: true when creating or resubmitting, so that several receipts
// waiting for approval cannot add up to more than the balance. False when
// approving, because only approved payments have touched the balance.
export async function validateCapitalPayments(
  client: SupabaseClient<Database>,
  args: { items: ReceiptLine[]; countPending: boolean; excludeReceiptId?: string },
): Promise<Result<void, ErrorDeDominio>> {
  const capitalByLoan = sumarAbonosPorPrestamo(
    args.items.flatMap((item) =>
      item.concept === 'pago_capital' && item.loan_id
        ? [{ prestamoId: item.loan_id, monto: Number(item.amount ?? 0) }]
        : [],
    ),
  );
  if (capitalByLoan.size === 0) return ok(undefined);

  const loanIds = [...capitalByLoan.keys()];
  const { data: loans, error: loansError } = await client
    .from('loans')
    .select('id, loan_number, outstanding_balance')
    .in('id', loanIds);
  if (loansError) throw loansError;

  let pendingByLoan = new Map<string, number>();
  if (args.countPending) {
    const { data: pending, error: pendingError } = await client
      .from('receipt_items')
      .select('loan_id, amount, receipt_id, receipts!inner(status)')
      .eq('concept', 'pago_capital')
      .in('loan_id', loanIds)
      .eq('receipts.status', 'pending');
    if (pendingError) throw pendingError;

    pendingByLoan = sumarAbonosPorPrestamo(
      (pending ?? []).flatMap((row) =>
        row.loan_id && row.receipt_id !== args.excludeReceiptId
          ? [{ prestamoId: row.loan_id, monto: Number(row.amount) }]
          : [],
      ),
    );
  }

  for (const loan of loans ?? []) {
    const result = validarAbonoACapital({
      saldoCapital: Number(loan.outstanding_balance),
      abonosPendientes: pendingByLoan.get(loan.id) ?? 0,
      abono: capitalByLoan.get(loan.id) ?? 0,
    });
    if (!result.ok) {
      return err({ ...result.error, mensaje: `Préstamo #${loan.loan_number}: ${result.error.mensaje}` });
    }
  }
  return ok(undefined);
}
