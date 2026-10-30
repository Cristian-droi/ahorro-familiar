// Lógica de negocio del módulo de préstamos.

import { crearFecha, hoyBogota, primerDiaDelMes, sumarMeses, type FechaISO } from '@/shared/domain/fechas';
import { ok, err, type Result, type ErrorDeDominio } from '@/shared/domain/result';
import { planAcordadoDesdeCuotas, planDePagos, validarPlanSolicitado } from '@/modules/prestamos/domain/plan-de-pagos';
import { mesAplicado } from '@/modules/prestamos/domain/calendario';
import { interesesAdeudados } from '@/modules/prestamos/domain/intereses-adeudados';
import { PLAZO_HASTA_PERIODO_SIGUIENTE_POR_DEFECTO, reglasDeInteresDelPrestamo } from '@/lib/loan-settings';

export interface PlanRow {
  month_number: number;
  due_date: string;
  capital_amount: number;
  estimated_interest: number;
  estimated_balance_after: number;
}

const NUMERO_DE_CUOTA = /^-?\d+$/;

// Adapter over the domain plan (src/modules/prestamos/domain/plan-de-pagos.ts):
// it keeps the `PlanRow` shape stored in `loan_payment_plan_items` and used by
// the UI. The loan's own stored fractional rate is required (no 2% fallback).
//
// Term (RN-4.3): `months` counts from the applied month (create, draft edits);
// `lastMonth` is the agreed last calendar month (disbursement). Without either,
// the maximum term applies.
//
// Capital (RN-4.26, RN-4.3b): `capitalOverrides` keys are either installment
// numbers ('5', relative to the applied month of `disbursedOn`, as the UI sends
// them) or calendar months ('2026-06-01').
//
// `requesting` (create and draft edits, RN-4.3b): the plan must run from the
// current month to the limit, so a past month is rejected instead of moved.
// At the disbursement it is false and past-month capital goes to the first month.
export function buildPaymentPlan(params: {
  requestedAmount: number;
  // Stored fraction, e.g. 0.02 for 2% monthly.
  rate: unknown;
  // Disbursement date (or today in Bogota for a draft).
  disbursedOn: FechaISO;
  months?: number;
  lastMonth?: FechaISO;
  capitalOverrides?: Record<string, number>;
  requesting?: boolean;
}): Result<PlanRow[], ErrorDeDominio> {
  const reglas = reglasDeInteresDelPrestamo(params.rate);
  if (!reglas.ok) return reglas;
  const inicio = mesAplicado(params.disbursedOn, reglas.value.diaDeCorte);

  let mesFinal = params.lastMonth;
  if (params.months !== undefined) {
    if (!Number.isInteger(params.months) || params.months < 1) {
      return err({ codigo: 'plazo_invalido', mensaje: 'El plazo debe ser un número entero de meses, de al menos 1.' });
    }
    mesFinal = sumarMeses(inicio, params.months - 1);
  }

  const capitalPorMes: Record<string, number> = {};
  for (const [clave, valor] of Object.entries(params.capitalOverrides ?? {})) {
    let mes: string = clave;
    if (NUMERO_DE_CUOTA.test(clave)) {
      const numero = Number(clave);
      if (numero < 1) {
        return err({ codigo: 'cuota_invalida', mensaje: `La cuota ${clave} no existe: las cuotas empiezan en 1.` });
      }
      mes = sumarMeses(inicio, numero - 1);
    }
    capitalPorMes[mes] = valor;
  }

  if (params.requesting) {
    const solicitado = validarPlanSolicitado({
      fechaSolicitud: params.disbursedOn,
      diaDeCorte: reglas.value.diaDeCorte,
      mesFinal,
      capitalPorMes,
    });
    if (!solicitado.ok) return solicitado;
  }

  const plan = planDePagos({
    monto: params.requestedAmount,
    fechaDesembolso: params.disbursedOn,
    reglas: reglas.value,
    hastaPeriodoSiguiente: PLAZO_HASTA_PERIODO_SIGUIENTE_POR_DEFECTO,
    mesFinal,
    capitalPorMes,
  });
  if (!plan.ok) return plan;
  return ok(
    plan.value.map((cuota) => ({
      month_number: cuota.numero,
      due_date: cuota.mes,
      capital_amount: cuota.capital,
      estimated_interest: cuota.interes,
      estimated_balance_after: cuota.saldoDespues,
    })),
  );
}

// RN-4.3 and RN-4.3b: the agreed plan stored in `loan_payment_plan_items` as
// the chosen last calendar month and the capital by calendar month, so the
// disbursement rebuilds it by month and not by installment number.
export function agreedPlanFromRows(
  rows: { due_date: string; capital_amount: number | string }[],
): Result<{ lastMonth: FechaISO | undefined; capitalOverrides: Record<string, number> }, ErrorDeDominio> {
  const cuotas: { mes: FechaISO; capital: number }[] = [];
  for (const row of rows) {
    const fecha = crearFecha(row.due_date);
    if (!fecha.ok) return fecha;
    cuotas.push({ mes: primerDiaDelMes(fecha.value), capital: Number(row.capital_amount) });
  }
  const plan = planAcordadoDesdeCuotas(cuotas);
  if (!plan.ok) return plan;
  return ok({ lastMonth: plan.value.mesFinal, capitalOverrides: plan.value.capitalPorMes });
}

// A receipt item of one loan, as stored in `receipt_items` (approved receipts).
export interface LoanInterestItem {
  concept: string;
  target_month: string;
  amount: number | string;
}

// `loans.disbursed_at` is a timestamptz; the rules read its day in Bogota.
function fechaDeDesembolso(valor: string): Result<FechaISO, ErrorDeDominio> {
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) return crearFecha(valor);
  const instante = new Date(valor);
  if (Number.isNaN(instante.getTime())) {
    return err({ codigo: 'fecha_invalida', mensaje: `La fecha "${valor}" no es válida.` });
  }
  return ok(hoyBogota(instante));
}

// Adapter over the domain interest owed (src/modules/prestamos/domain/
// intereses-adeudados.ts, section 11 n.º 13): it maps the loan fields and its
// approved `pago_capital` / `pago_intereses` items. `today` defaults to the
// Bogota date of the clock, which is only read here.
export function calcAccruedInterest(params: {
  requestedAmount: number | string;
  // Stored fraction, e.g. 0.02 for 2% monthly.
  rate: unknown;
  disbursedAt: string;
  items: LoanInterestItem[];
  today?: FechaISO;
}): Result<number, ErrorDeDominio> {
  const reglas = reglasDeInteresDelPrestamo(params.rate);
  if (!reglas.ok) return reglas;
  const fechaDesembolso = fechaDeDesembolso(params.disbursedAt);
  if (!fechaDesembolso.ok) return fechaDesembolso;

  const abonosACapital: { mes: FechaISO; monto: number }[] = [];
  const pagosDeIntereses: { monto: number }[] = [];
  for (const item of params.items) {
    if (item.concept === 'pago_capital') {
      const mes = crearFecha(item.target_month);
      if (!mes.ok) return mes;
      abonosACapital.push({ mes: mes.value, monto: Number(item.amount) });
    } else if (item.concept === 'pago_intereses') {
      pagosDeIntereses.push({ monto: Number(item.amount) });
    }
  }

  const r = interesesAdeudados({
    fechaDesembolso: fechaDesembolso.value,
    hoy: params.today ?? hoyBogota(new Date()),
    monto: Number(params.requestedAmount),
    abonosACapital,
    pagosDeIntereses,
    reglas: reglas.value,
  });
  return r.ok ? ok(r.value.adeudado) : r;
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
  overdue_interest_debt: number;
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

function getBogotaCurrentMonthKey(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  return `${year}-${month}`;
}

// Calcula el libro mensual de un préstamo:
//   - Plan teórico (loan_payment_plan_items)
//   - Pagos reales (receipt_items con loan_id y recibo aprobado)
// Los pagos se matchean por mes calendario (YYYY-MM).
export function computeLoanBook(params: {
  requestedAmount: number;
  plan: PlanRow[];
  payments: LoanBookPayment[];
  interestRate?: number;
  disbursedAt?: string | null;
}): LoanBook {
  const { requestedAmount, plan, payments } = params;

  const currentMonthKey = getBogotaCurrentMonthKey();

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
  let overdueInterestDebt = 0;
  let nextFound = false;
  let nextInstallmentAmount: number | null = null;
  let nextInstallmentMonth: string | null = null;

  const months: LoanBookMonthRow[] = plan.map((row) => {
    const key = monthKey(row.due_date);
    const paidCapital = paidCapitalByMonth.get(key) ?? 0;
    const paidInterest = paidInterestByMonth.get(key) ?? 0;

    // Deuda de intereses generada este mes (solo acumulamos mora de meses anteriores al actual)
    const interestDebt =
      key < currentMonthKey
        ? Math.max(0, row.estimated_interest - paidInterest)
        : 0;

    runningBalance = Math.max(0, runningBalance - paidCapital);
    totalPaidCapital += paidCapital;
    totalPaidInterest += paidInterest;
    totalInterestDebt += interestDebt;

    if (key < currentMonthKey) {
      overdueInterestDebt += interestDebt;
    }

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
      overdue_interest_debt: overdueInterestDebt,
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
  overdue_interest_debt: number;
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
        if (lastRow) {
          capital_balance_after += lastRow.capital_balance_after;
        }
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
      overdue_interest_debt:
        acc.overdue_interest_debt + b.book.summary.overdue_interest_debt,
      current_capital_balance:
        acc.current_capital_balance + b.book.summary.current_capital_balance,
    }),
    {
      total_requested: 0,
      total_paid_capital: 0,
      total_paid_interest: 0,
      total_interest_debt: 0,
      overdue_interest_debt: 0,
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
  // RN-4.5b: more than 15 days from submission without a disbursement.
  expired: 'Anulada por vencimiento',
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
  expired: 'neutral',
};
