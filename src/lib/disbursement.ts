import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { DeductionDetail } from '@/types/entities';
import type { PlanRow } from '@/lib/loans';
import { hoyBogota, primerDiaDelMes, type FechaISO } from '@/shared/domain/fechas';

type ReceiptConcept = Database['public']['Enums']['receipt_concept'];

export interface DisbursementReceiptItem {
  concept: ReceiptConcept;
  target_month: string;
  share_count: number | null;
  unit_value: number | null;
  amount: number;
  loan_id: string | null;
  auto_generated: boolean;
}

// Items of the receipt the disbursement approves on the spot: the loan shares
// discounted from it (RN-4.14) and the obligations the shareholder chose to
// deduct. The month is the disbursement month in Bogota.
export function buildDisbursementReceipt(input: {
  loanId: string;
  loanSharesAmount: number;
  loanSharesCount: number | null;
  loanSharesPaidUpfront: boolean;
  deductions: DeductionDetail[];
  unitValue: number | null;
  disbursedAt: Date;
}): { items: DisbursementReceiptItem[]; interestPaidMonth: FechaISO } {
  const month = primerDiaDelMes(hoyBogota(input.disbursedAt));
  const items: DisbursementReceiptItem[] = [];

  if (!input.loanSharesPaidUpfront && input.loanSharesAmount > 0) {
    const count = input.loanSharesCount != null && input.loanSharesCount > 0 ? input.loanSharesCount : null;
    items.push({
      concept: 'acciones_prestamo',
      target_month: month,
      share_count: count,
      unit_value: count != null ? input.unitValue : null,
      amount: input.loanSharesAmount,
      loan_id: input.loanId,
      auto_generated: false,
    });
  }

  for (const d of input.deductions) {
    items.push({
      concept: d.concept,
      target_month: d.target_month,
      share_count: d.share_count ?? null,
      unit_value: d.unit_value ?? null,
      amount: d.amount,
      loan_id: d.loan_id ?? null,
      auto_generated: d.concept === 'multa_acciones',
    });
  }

  return { items, interestPaidMonth: month };
}

export interface DisbursementValues {
  disbursed_amount: number;
  four_per_thousand: number;
  disbursed_at: string;
  full_rate_day_limit: number;
  cutoff_day: number;
  disbursement_proof_path: string | null;
  payment_method: 'transfer' | 'cash';
  // RN-4.15: first day of the month the loan counts for.
  applied_month: string;
  // Stored as last_interest_payment_date on the loans whose interest is deducted.
  interest_paid_month: string;
}

export type DisburseResult =
  | { ok: true; ceNumber: string }
  | {
      ok: false;
      status: 409 | 422 | 500;
      code: 'stale_status' | 'upfront_shares_unpaid' | 'insufficient_cash_balance' | 'unexpected';
      message: string;
    };

const KNOWN_ERRORS = {
  audit_status_conflict: {
    status: 409,
    code: 'stale_status',
    message: 'El préstamo cambió de estado mientras se desembolsaba. Recarga la página.',
  },
  upfront_shares_unpaid: {
    status: 422,
    code: 'upfront_shares_unpaid',
    message: 'El accionista eligió pagar las acciones por adelantado. El recibo de acciones por préstamo aún no está aprobado.',
  },
  insufficient_cash_balance: {
    status: 422,
    code: 'insufficient_cash_balance',
    message: 'El saldo en caja no alcanza para desembolsar este préstamo.',
  },
} as const;

// RN-4.17: the loan, its plan, the deduction receipt, the CE and the audit
// record are written in one database transaction, or none of them is.
export async function disburseLoan(
  client: SupabaseClient<Database>,
  input: {
    loanId: string;
    actorId: string;
    disbursement: DisbursementValues;
    plan: PlanRow[];
    receiptItems: DisbursementReceiptItem[];
  },
): Promise<DisburseResult> {
  const { data, error } = await client.rpc('desembolsar_prestamo', {
    p_loan_id: input.loanId,
    p_actor: input.actorId,
    p_disbursement: input.disbursement as unknown as Database['public']['Functions']['desembolsar_prestamo']['Args']['p_disbursement'],
    p_plan: input.plan as unknown as Database['public']['Functions']['desembolsar_prestamo']['Args']['p_plan'],
    p_receipt_items: input.receiptItems as unknown as Database['public']['Functions']['desembolsar_prestamo']['Args']['p_receipt_items'],
  });
  if (error) {
    const known = Object.entries(KNOWN_ERRORS).find(([key]) => error.message.includes(key));
    if (known) return { ok: false, ...known[1] };
    return { ok: false, status: 500, code: 'unexpected', message: error.message };
  }
  return { ok: true, ceNumber: String(data) };
}
