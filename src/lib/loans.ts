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

  // ===== 1) Calcular el capital de cada cuota antes de iterar =====
  //
  // Reglas (acordadas con el user):
  //   - Sin overrides: distribución uniforme (último mes absorbe redondeo).
  //   - Con overrides:
  //       a) Cuotas con override → su valor exacto.
  //       b) Cuotas anteriores al ÚLTIMO override sin override propio →
  //          mantienen `baseCapital` siempre que la suma total no exceda
  //          el requested. Si excede, se ponen en 0.
  //       c) Cuotas posteriores al último override sin override propio →
  //          comparten el saldo restante en partes iguales (último de
  //          ellas absorbe redondeo).
  //
  // Ejemplo: 1.000.000 a 10 meses, edita cuota 5 = 200k →
  //   cuotas 1-4 = 100k (mantienen base), cuota 5 = 200k (override),
  //   cuotas 6-10 = 80k (400k restantes / 5).
  //
  // Ejemplo: 1.000.000 a 10 meses, edita cuota 10 = 1M →
  //   anteriores con baseCapital sumarían 900k, + 1M override = 1.9M >
  //   1M → se borran las anteriores, todo queda en cuota 10.
  const capitals: number[] = new Array(months).fill(0);

  if (!hasOverrides) {
    for (let i = 0; i < months; i++) {
      capitals[i] =
        i === months - 1 ? requestedAmount - baseCapital * (months - 1) : baseCapital;
    }
  } else {
    const overrideKeys = Object.keys(capitalOverrides).map(Number).sort((a, b) => a - b);
    const lastOverrideIdx = overrideKeys[overrideKeys.length - 1];

    // Pasada inicial: overrides + baseCapital para anteriores no editadas.
    for (let m = 1; m <= months; m++) {
      if (capitalOverrides[m] !== undefined) {
        capitals[m - 1] = Math.max(0, capitalOverrides[m]);
      } else if (m < lastOverrideIdx) {
        capitals[m - 1] = baseCapital;
      } else {
        capitals[m - 1] = 0; // posteriores se redistribuyen abajo
      }
    }

    let consumed = capitals.reduce((s, v) => s + v, 0);
    let remaining = requestedAmount - consumed;

    if (remaining < 0) {
      // Las anteriores baseCapital + overrides exceden el total. Bajamos
      // las anteriores no editadas a 0 y recalculamos.
      for (let m = 1; m < lastOverrideIdx; m++) {
        if (capitalOverrides[m] === undefined) capitals[m - 1] = 0;
      }
      consumed = capitals.reduce((s, v) => s + v, 0);
      remaining = Math.max(0, requestedAmount - consumed);
    }

    // Distribuir remaining entre los posteriores al último override sin
    // override propio.
    const posteriorsNoOverride: number[] = [];
    for (let m = lastOverrideIdx + 1; m <= months; m++) {
      if (capitalOverrides[m] === undefined) posteriorsNoOverride.push(m);
    }

    if (posteriorsNoOverride.length > 0) {
      const chunk = Math.floor(remaining / posteriorsNoOverride.length);
      for (let i = 0; i < posteriorsNoOverride.length - 1; i++) {
        capitals[posteriorsNoOverride[i] - 1] = chunk;
      }
      const last = posteriorsNoOverride[posteriorsNoOverride.length - 1];
      capitals[last - 1] = remaining - chunk * (posteriorsNoOverride.length - 1);
    } else if (remaining !== 0) {
      // No hay posteriores no editados: el último mes absorbe el ajuste
      // (puede tener override propio que se incrementa).
      capitals[months - 1] += remaining;
    }
  }

  // ===== 2) Construir las rows con los capitales calculados =====
  const rows: PlanRow[] = [];
  let balance = requestedAmount;

  for (let i = 1; i <= months; i++) {
    const isFirst = i === 1;
    const effectiveRate = isFirst && disbursedDay > 15 ? rate / 2 : rate;
    const interest = Math.round(balance * effectiveRate);

    const capital = Math.max(0, Math.min(capitals[i - 1], balance));
    const balanceAfter = Math.max(0, balance - capital);

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
  // Acotar el matching al rango del plan: si llega un pago con
  // target_month antes del primer mes del plan (caso típico:
  // next_due_month calculado mes_actual−1 cuando el préstamo se
  // desembolsó este mismo mes), lo asignamos al primer mes del plan.
  // Si llega después del último, lo asignamos al último. Así nunca se
  // "pierde" un pago.
  const planMonthKeys = plan.map((r) => monthKey(r.due_date));
  const firstPlanKey = planMonthKeys[0] ?? null;
  const lastPlanKey = planMonthKeys[planMonthKeys.length - 1] ?? null;
  const clamp = (key: string) => {
    if (firstPlanKey && key < firstPlanKey) return firstPlanKey;
    if (lastPlanKey && key > lastPlanKey) return lastPlanKey;
    return key;
  };
  for (const p of payments) {
    const key = clamp(monthKey(p.target_month));
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

// ============================================================
// Libro unificado — todos los préstamos del accionista en una sola tabla
// mes a mes. Sirve para ver el panorama global sin tener que mirar préstamo
// por préstamo.
// ============================================================

export interface UnifiedLoanBookRow {
  month_key: string; // 'YYYY-MM'
  due_date: string; // primer día del mes
  // Cuántos préstamos NUEVOS se desembolsaron este mes (suma del monto).
  // Se usa solo informativo en la columna "Préstamo".
  disbursed_this_month: number;
  // Sumas mensuales de los planes de pago de los préstamos vigentes este mes.
  plan_capital: number;
  plan_interest: number;
  // Sumas de pagos reales con target_month = ese mes.
  paid_capital: number;
  paid_interest: number;
  // Intereses NO pagados de ese mes (la mora se mide por mes plan).
  interest_debt: number;
  // Saldo de capital acumulado al cierre del mes (suma de saldos de cada
  // préstamo). Para préstamos que aún no arrancaron en este mes, su saldo
  // efectivo es 0; para los que ya terminaron, también 0.
  capital_balance_after: number;
}

export interface UnifiedLoanBookSummary {
  total_requested: number;
  total_paid_capital: number;
  total_paid_interest: number;
  total_interest_debt: number;
  current_capital_balance: number;
}

export interface UnifiedLoanBook {
  rows: UnifiedLoanBookRow[];
  summary: UnifiedLoanBookSummary;
}

// Combina N libros (uno por préstamo) en una tabla mes-a-mes con los
// totales del accionista. Toma como base la unión de las due_date de
// todos los planes — por cada mes calendario en ese set, suma los valores
// del libro respectivo. Si un préstamo no tiene fila para ese mes (porque
// arrancó después o ya terminó), aporta 0.
export function computeUnifiedLoanBook(
  books: { requested: number; book: LoanBook; disbursedAt: string | null }[],
): UnifiedLoanBook {
  // 1. Unión de meses calendario.
  const monthSet = new Set<string>();
  for (const b of books) {
    for (const r of b.book.months) monthSet.add(r.due_date.slice(0, 7));
  }
  const sortedMonths = Array.from(monthSet).sort();

  // 2. Mapa de cuotas reales por mes y por préstamo (para sumar).
  const rows: UnifiedLoanBookRow[] = sortedMonths.map((monthKey) => {
    const dueDate = `${monthKey}-01`;
    let plan_capital = 0;
    let plan_interest = 0;
    let paid_capital = 0;
    let paid_interest = 0;
    let interest_debt = 0;
    let capital_balance_after = 0;
    let disbursed_this_month = 0;

    for (const b of books) {
      // Préstamo desembolsado en este mes calendario.
      if (b.disbursedAt && b.disbursedAt.slice(0, 7) === monthKey) {
        disbursed_this_month += b.requested;
      }

      // Buscar la fila del plan en este mes.
      const row = b.book.months.find((m) => m.due_date.slice(0, 7) === monthKey);
      if (row) {
        plan_capital += row.plan_capital;
        plan_interest += row.plan_interest;
        paid_capital += row.paid_capital;
        paid_interest += row.paid_interest;
        interest_debt += row.interest_debt;
        capital_balance_after += row.capital_balance_after;
      } else {
        // Préstamo que aún no empezó (mes anterior a su plan) o que ya
        // terminó (mes posterior a su último plan): no aporta cuota, pero
        // sí aporta su saldo restante al "capital_balance_after" si
        // todavía está activo. Para no confundir, usamos: si el mes es
        // posterior al plan, saldo final = 0 (préstamo cerrado); si es
        // anterior, saldo = requested (todavía no se desembolsó).
        const planMin = b.book.months[0]?.due_date.slice(0, 7) ?? null;
        if (planMin !== null && monthKey < planMin) {
          // antes de arrancar: aún no hay deuda contable de este préstamo
          continue;
        }
        // después del último mes: el saldo ya cerró en el último plan,
        // así que tomamos el último saldo.
        const lastRow = b.book.months[b.book.months.length - 1];
        if (lastRow) capital_balance_after += lastRow.capital_balance_after;
      }
    }

    return {
      month_key: monthKey,
      due_date: dueDate,
      disbursed_this_month,
      plan_capital,
      plan_interest,
      paid_capital,
      paid_interest,
      interest_debt,
      capital_balance_after,
    };
  });

  const summary: UnifiedLoanBookSummary = books.reduce(
    (acc, b) => ({
      total_requested: acc.total_requested + b.book.summary.requested_amount,
      total_paid_capital:
        acc.total_paid_capital + b.book.summary.total_paid_capital,
      total_paid_interest:
        acc.total_paid_interest + b.book.summary.total_paid_interest,
      total_interest_debt:
        acc.total_interest_debt + b.book.summary.total_interest_debt,
      current_capital_balance:
        acc.current_capital_balance + b.book.summary.current_capital_balance,
    }),
    {
      total_requested: 0,
      total_paid_capital: 0,
      total_paid_interest: 0,
      total_interest_debt: 0,
      current_capital_balance: 0,
    },
  );

  return { rows, summary };
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
