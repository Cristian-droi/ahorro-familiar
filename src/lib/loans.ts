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
  const rows: PlanRow[] = [];
  let balance = requestedAmount;

  for (let i = 1; i <= months; i++) {
    if (balance <= 0) break;

    const isFirst = i === 1;
    const effectiveRate = isFirst && disbursedDay > 15 ? rate / 2 : rate;
    const interest = Math.round(balance * effectiveRate);

    const capital =
      i === months
        ? balance
        : Math.max(0, Math.min(capitalOverrides[i] ?? baseCapital, balance));

    const balanceAfter = Math.max(0, balance - capital);

    const due = new Date(disbursedAt);
    due.setMonth(due.getMonth() + i);
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
