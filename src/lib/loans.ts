// Lógica de negocio del módulo de préstamos.

export const LOAN_SHARES_STEP = 500_000; // 1 acción por préstamo cada 500k

export interface PlanRow {
  month_number: number;
  due_date: string;
  capital_amount: number;
  estimated_interest: number;
  estimated_balance_after: number;
}

export function calcLoanShares(requestedAmount: number, shareValue: number) {
  const count = Math.floor(requestedAmount / LOAN_SHARES_STEP);
  return { count, amount: count * shareValue };
}

export function calcFourPerThousand(amount: number): number {
  return Math.round(amount * 0.004);
}

export function calcDisbursedAmount(
  requestedAmount: number,
  sharesAmount: number,
  paidUpfront: boolean,
  fourPerThousand: number,
): number {
  const sharesDiscount = paidUpfront ? 0 : sharesAmount;
  return requestedAmount - sharesDiscount - fourPerThousand;
}

export function buildPaymentPlan(params: {
  requestedAmount: number;
  months: number;
  rate: number;
  disbursedAt: Date;
  capitalOverrides?: Record<number, number>;
}): PlanRow[] {
  const { requestedAmount, months, rate, disbursedAt, capitalOverrides = {} } = params;
  const baseCapital = Math.floor(requestedAmount / months);
  const disbursedDay = disbursedAt.getDate();
  const hasOverrides = Object.keys(capitalOverrides).length > 0;
  const rows: PlanRow[] = [];
  let balance = requestedAmount;

  for (let i = 1; i <= months; i++) {
    if (balance <= 0 && i !== months) {
      // Balance already 0 from earlier overrides — remaining months get 0 capital.
      const due = new Date(disbursedAt);
      due.setMonth(due.getMonth() + (i - 1));
      due.setDate(1);
      rows.push({
        month_number: i,
        due_date: due.toISOString().split('T')[0],
        capital_amount: 0,
        estimated_interest: 0,
        estimated_balance_after: 0,
      });
      continue;
    }

    const isFirst = i === 1;
    const effectiveRate = isFirst && disbursedDay > 15 ? rate / 2 : rate;
    const interest = Math.round(balance * effectiveRate);

    // Last month always absorbs remaining balance.
    // For other months: use override if set, else 0 when any overrides exist, else equal split.
    const rawCapital =
      i === months
        ? balance
        : capitalOverrides[i] !== undefined
          ? capitalOverrides[i]
          : hasOverrides
            ? 0
            : baseCapital;

    const capital = Math.max(0, Math.min(rawCapital, balance));
    const balanceAfter = Math.max(0, balance - capital);

    // Month 1 = current month, month 2 = next month, etc.
    const due = new Date(disbursedAt);
    due.setMonth(due.getMonth() + (i - 1));
    due.setDate(1);

    rows.push({
      month_number: i,
      due_date: due.toISOString().split('T')[0],
      capital_amount: capital,
      estimated_interest: interest,
      estimated_balance_after: balanceAfter,
    });

    balance = balanceAfter;
  }

  return rows;
}

export function calcAccruedInterest(params: {
  outstandingBalance: number;
  rate: number;
  disbursedAt: Date;
  lastInterestPaymentDate: Date | null;
}): number {
  const { outstandingBalance, rate, disbursedAt, lastInterestPaymentDate } = params;
  const from = lastInterestPaymentDate ?? disbursedAt;
  const now = new Date();

  const months =
    (now.getFullYear() - from.getFullYear()) * 12 +
    (now.getMonth() - from.getMonth());

  if (months <= 0) return 0;

  const isFirstEver = lastInterestPaymentDate === null;
  const disbursedDay = disbursedAt.getDate();
  let total = 0;

  for (let m = 1; m <= months; m++) {
    const effectiveRate = isFirstEver && m === 1 && disbursedDay > 15 ? rate / 2 : rate;
    total += Math.round(outstandingBalance * effectiveRate);
  }

  return total;
}

export function requiredVotes(totalActive: number): number {
  return Math.floor(totalActive / 2) + 1;
}

// ============================================================
// Libro de accionista — conciliación plan vs pagado mes a mes
// ============================================================

export interface LoanBookPayment {
  target_month: string; // ISO YYYY-MM-DD (primer día del mes)
  concept: 'pago_capital' | 'pago_intereses';
  amount: number;
}

export interface LoanBookMonthRow {
  month_number: number;
  due_date: string; // ISO YYYY-MM-DD
  plan_capital: number;
  plan_interest: number;
  paid_capital: number;
  paid_interest: number;
  // Intereses en mora: cuánto quedó debiendo del interés planeado este mes.
  interest_debt: number;
  // Saldo de capital al cierre del mes (tras restar lo efectivamente pagado hasta aquí).
  capital_balance_after: number;
  // Cuota "ideal" del mes según plan (capital + interés plan).
  installment_value: number;
  // true en el primer mes cuyo capital aún no se paga completo.
  is_next_installment: boolean;
}

export interface LoanBookSummary {
  requested_amount: number;
  total_paid_capital: number;
  total_paid_interest: number;
  total_interest_debt: number;
  current_capital_balance: number;
  next_installment_amount: number | null;
  next_installment_month: string | null;
}

export interface LoanBook {
  summary: LoanBookSummary;
  months: LoanBookMonthRow[];
}

function monthKey(isoDate: string): string {
  // Acepta tanto "YYYY-MM-DD" como "YYYY-MM" y devuelve "YYYY-MM".
  return isoDate.slice(0, 7);
}

// Calcula el libro mensual de un préstamo:
//   - Plan teórico (loan_payment_plan_items)
//   - Pagos reales (receipt_items con loan_id y recibo aprobado)
// Los pagos se matchean por mes calendario (YYYY-MM).
export function computeLoanBook(params: {
  requestedAmount: number;
  plan: PlanRow[];
  payments: LoanBookPayment[];
}): LoanBook {
  const { requestedAmount, plan, payments } = params;

  const paidCapitalByMonth = new Map<string, number>();
  const paidInterestByMonth = new Map<string, number>();
  for (const p of payments) {
    const key = monthKey(p.target_month);
    if (p.concept === 'pago_capital') {
      paidCapitalByMonth.set(key, (paidCapitalByMonth.get(key) ?? 0) + Number(p.amount));
    } else if (p.concept === 'pago_intereses') {
      paidInterestByMonth.set(key, (paidInterestByMonth.get(key) ?? 0) + Number(p.amount));
    }
  }

  let runningBalance = requestedAmount;
  let totalPaidCapital = 0;
  let totalPaidInterest = 0;
  let totalInterestDebt = 0;
  let nextFound = false;
  let nextInstallmentAmount: number | null = null;
  let nextInstallmentMonth: string | null = null;

  const months: LoanBookMonthRow[] = plan.map((row) => {
    const key = monthKey(row.due_date);
    const paidCapital = paidCapitalByMonth.get(key) ?? 0;
    const paidInterest = paidInterestByMonth.get(key) ?? 0;
    const interestDebt = Math.max(0, row.estimated_interest - paidInterest);
    runningBalance = Math.max(0, runningBalance - paidCapital);
    totalPaidCapital += paidCapital;
    totalPaidInterest += paidInterest;
    totalInterestDebt += interestDebt;

    // Próxima cuota = primer mes cuyo capital aún no cubre lo planeado.
    const isNext =
      !nextFound && paidCapital < row.capital_amount && row.capital_amount > 0;
    if (isNext) {
      nextFound = true;
      nextInstallmentAmount = row.capital_amount + row.estimated_interest;
      nextInstallmentMonth = row.due_date;
    }

    return {
      month_number: row.month_number,
      due_date: row.due_date,
      plan_capital: row.capital_amount,
      plan_interest: row.estimated_interest,
      paid_capital: paidCapital,
      paid_interest: paidInterest,
      interest_debt: interestDebt,
      capital_balance_after: runningBalance,
      installment_value: row.capital_amount + row.estimated_interest,
      is_next_installment: isNext,
    };
  });

  return {
    summary: {
      requested_amount: requestedAmount,
      total_paid_capital: totalPaidCapital,
      total_paid_interest: totalPaidInterest,
      total_interest_debt: totalInterestDebt,
      current_capital_balance: Math.max(0, requestedAmount - totalPaidCapital),
      next_installment_amount: nextInstallmentAmount,
      next_installment_month: nextInstallmentMonth,
    },
    months,
  };
}

export const LOAN_STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador',
  pending_review: 'En revisión',
  pending_shareholder_vote: 'En votación',
  pending_disbursement: 'Listo para desembolso',
  active: 'Activo',
  paid: 'Pagado',
  rejected_by_admin: 'Rechazado (admin)',
  rejected_by_shareholders: 'Rechazado (votación)',
};

export const LOAN_STATUS_TONE: Record<string, string> = {
  draft: 'neutral',
  pending_review: 'warn',
  pending_shareholder_vote: 'info',
  pending_disbursement: 'brand',
  active: 'success',
  paid: 'success',
  rejected_by_admin: 'danger',
  rejected_by_shareholders: 'danger',
};
