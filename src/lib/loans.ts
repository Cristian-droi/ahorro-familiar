// Lógica de negocio del módulo de préstamos.

import { crearFecha, hoyBogota, mesesEntre, primerDiaDelMes, sumarMeses, type FechaISO } from '@/shared/domain/fechas';
import { ok, err, type Result, type ErrorDeDominio } from '@/shared/domain/result';
import { planAcordadoDesdeCuotas, planDePagos, validarPlanSolicitado } from '@/modules/prestamos/domain/plan-de-pagos';
import { mesAplicado } from '@/modules/prestamos/domain/calendario';
import { interesesAdeudados, saldoDeCapital } from '@/modules/prestamos/domain/intereses-adeudados';
import type { ReglasDeInteres } from '@/modules/prestamos/domain/intereses';
import {
  libroDelPrestamo,
  libroUnificado,
  type CuotaPactada,
  type LibroDelPrestamo,
  type PagoAlPrestamo,
} from '@/modules/prestamos/domain/libro-del-prestamo';
import { AJUSTES_DE_PRESTAMO_POR_DEFECTO, reglasDeInteresDelPrestamo, type AjustesDePrestamo } from '@/lib/loan-settings';

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
//
// `ajustes` (RN-4.20, RN-4.21, RN-4.3 ⚙️): the loan settings from
// `getAjustesDePrestamo`; without them the section 10 defaults apply.
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
  ajustes?: AjustesDePrestamo;
}): Result<PlanRow[], ErrorDeDominio> {
  const ajustes = params.ajustes ?? AJUSTES_DE_PRESTAMO_POR_DEFECTO;
  const reglas = reglasDeInteresDelPrestamo(params.rate, ajustes);
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
    hastaPeriodoSiguiente: ajustes.plazoHastaPeriodoSiguiente,
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
  // RN-4.20, RN-4.21 ⚙️: defaults to section 10.
  ajustes?: AjustesDePrestamo;
}): Result<number, ErrorDeDominio> {
  const reglas = reglasDeInteresDelPrestamo(params.rate, params.ajustes);
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

export interface ActiveLoanDebtSummary {
  // Disbursed amount minus every approved capital payment (RN-4.29: never negative).
  outstandingCapital: number;
  // From `calcAccruedInterest`, the single source of interest (section 11, n.º 13).
  interestOwed: number;
  // Finished calendar months since the disbursement month (RN-4.22b).
  monthsOverdue: number;
  // Month for the payment items: the last finished month, never before the
  // disbursement month.
  nextDueMonth: FechaISO;
}

// Replaces the SQL `get_user_active_loans_debt` per loan: same fields, with
// the interest owed taken from the domain instead of SQL.
export function summarizeActiveLoanDebt(params: {
  requestedAmount: number | string;
  rate: unknown;
  disbursedAt: string;
  items: LoanInterestItem[];
  today?: FechaISO;
  // RN-4.20, RN-4.21 ⚙️: defaults to section 10.
  ajustes?: AjustesDePrestamo;
}): Result<ActiveLoanDebtSummary, ErrorDeDominio> {
  const today = params.today ?? hoyBogota(new Date());
  const interestOwed = calcAccruedInterest({ ...params, today });
  if (!interestOwed.ok) return interestOwed;
  const fechaDesembolso = fechaDeDesembolso(params.disbursedAt);
  if (!fechaDesembolso.ok) return fechaDesembolso;

  const abonosACapital: { mes: FechaISO; monto: number }[] = [];
  for (const item of params.items) {
    if (item.concept !== 'pago_capital') continue;
    const mes = crearFecha(item.target_month);
    if (!mes.ok) return mes;
    abonosACapital.push({ mes: mes.value, monto: Number(item.amount) });
  }
  const saldo = saldoDeCapital({ monto: Number(params.requestedAmount), abonosACapital });
  if (!saldo.ok) return saldo;
  // RN-4.21: after the cut-off day the loan counts from the next month.
  const disbursementMonth = mesAplicado(
    fechaDesembolso.value,
    (params.ajustes ?? AJUSTES_DE_PRESTAMO_POR_DEFECTO).diaDeCorte,
  );
  const currentMonth = primerDiaDelMes(today);
  const monthsOverdue = Math.max(mesesEntre(disbursementMonth, currentMonth), 0);

  return ok({
    outstandingCapital: saldo.value,
    interestOwed: interestOwed.value,
    monthsOverdue,
    nextDueMonth: monthsOverdue > 0 ? sumarMeses(currentMonth, -1) : disbursementMonth,
  });
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
  // Intereses en mora del mes: interés sobre el saldo real (RN-4.18) que no
  // cubren los intereses pagados para ese mes. Solo meses terminados (RN-4.22b).
  interest_debt: number;
  // RN-4.31: intereses pendientes acumulados hasta este mes.
  pending_interest: number;
  // Saldo de capital al cierre del mes (tras restar lo efectivamente pagado hasta aquí).
  capital_balance_after: number;
  // Cuota "ideal" del mes según plan (capital + interés plan).
  installment_value: number;
  // true en el primer mes cuyo capital aún no se paga completo; nunca en un
  // préstamo pagado (RN-4.28).
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
  // Totales del plan pactado (RN-4.3b, informativo).
  total_plan_capital: number;
  total_plan_interest: number;
  total_installment_value: number;
}

export interface LoanBook {
  summary: LoanBookSummary;
  months: LoanBookMonthRow[];
}

function pagosDelLibro(payments: LoanBookPayment[]): Result<PagoAlPrestamo[], ErrorDeDominio> {
  const pagos: PagoAlPrestamo[] = [];
  for (const p of payments) {
    if (p.concept !== 'pago_capital' && p.concept !== 'pago_intereses') continue;
    const mes = crearFecha(p.target_month.slice(0, 10));
    if (!mes.ok) return mes;
    pagos.push({ mes: mes.value, concepto: p.concept === 'pago_capital' ? 'capital' : 'intereses', monto: Number(p.amount) });
  }
  return ok(pagos);
}

// Adapter over the domain loan book (src/modules/prestamos/domain/
// libro-del-prestamo.ts): it maps the stored plan rows and the approved
// payments, and keeps the legacy snake_case shape for the pages. `today`
// defaults to the Bogota date of the clock, which is only read here.
export function computeLoanBook(params: {
  requestedAmount: number;
  plan: PlanRow[];
  payments: LoanBookPayment[];
  // Stored fraction, e.g. 0.02 for 2% monthly. Required once disbursed.
  interestRate?: unknown;
  disbursedAt?: string | null;
  today?: FechaISO;
  // RN-4.20, RN-4.21 ⚙️: defaults to section 10.
  ajustes?: AjustesDePrestamo;
}): Result<LoanBook, ErrorDeDominio> {
  const plan: CuotaPactada[] = [];
  for (const row of params.plan) {
    const mes = crearFecha(row.due_date.slice(0, 10));
    if (!mes.ok) return mes;
    plan.push({
      numero: row.month_number,
      mes: mes.value,
      capital: Number(row.capital_amount),
      interes: Number(row.estimated_interest),
    });
  }
  const pagos = pagosDelLibro(params.payments);
  if (!pagos.ok) return pagos;

  let desembolso: { fecha: FechaISO; reglas: ReglasDeInteres } | null = null;
  if (params.disbursedAt) {
    const reglas = reglasDeInteresDelPrestamo(params.interestRate, params.ajustes);
    if (!reglas.ok) return reglas;
    const fecha = fechaDeDesembolso(params.disbursedAt);
    if (!fecha.ok) return fecha;
    desembolso = { fecha: fecha.value, reglas: reglas.value };
  }

  const libro = libroDelPrestamo({
    monto: Number(params.requestedAmount),
    plan,
    pagos: pagos.value,
    desembolso,
    mesActual: params.today ?? hoyBogota(new Date()),
  });
  if (!libro.ok) return libro;
  const { meses, resumen } = libro.value;
  return ok({
    summary: {
      requested_amount: resumen.monto,
      total_paid_capital: resumen.capitalPagado,
      total_paid_interest: resumen.interesesPagados,
      total_interest_debt: resumen.interesesEnMora,
      overdue_interest_debt: resumen.interesesEnMora,
      current_capital_balance: resumen.saldoCapital,
      next_installment_amount: resumen.proximaCuota?.monto ?? null,
      next_installment_month: resumen.proximaCuota?.mes ?? null,
      total_plan_capital: resumen.capitalPactado,
      total_plan_interest: resumen.interesPactado,
      total_installment_value: resumen.cuotasPactadas,
    },
    months: meses.map((m) => ({
      month_number: m.numero,
      due_date: m.mes,
      plan_capital: m.capitalPactado,
      plan_interest: m.interesPactado,
      paid_capital: m.capitalPagado,
      paid_interest: m.interesPagado,
      interest_debt: m.interesEnMora,
      pending_interest: m.interesesPendientesAcumulados,
      capital_balance_after: m.saldoCapitalDespues,
      installment_value: m.cuotaPactada,
      is_next_installment: m.esLaProximaCuota,
    })),
  });
}

// ============================================================
// Libro unificado — todos los préstamos del accionista en una sola tabla
// mes a mes. Sirve para ver el panorama global sin tener que mirar préstamo
// por préstamo.
// ============================================================

export interface UnifiedLoanBookRow {
  month_key: string; // 'YYYY-MM'
  due_date: string; // primer día del mes
  // Monto de los préstamos desembolsados este mes (día en Bogotá).
  // Se usa solo informativo en la columna "Préstamo".
  disbursed_this_month: number;
  // Sumas mensuales de los planes de pago de los préstamos vigentes este mes.
  plan_capital: number;
  plan_interest: number;
  installment_value: number;
  // Sumas de pagos reales con target_month = ese mes.
  paid_capital: number;
  paid_interest: number;
  // Intereses en mora de ese mes (RN-4.18, saldo real).
  interest_debt: number;
  // RN-4.31: suma de los intereses pendientes acumulados de cada préstamo.
  pending_interest: number;
  // Saldo de capital acumulado al cierre del mes (suma de saldos de cada
  // préstamo). Un préstamo no aporta antes de su primer mes y aporta su
  // último saldo después de su último mes.
  capital_balance_after: number;
}

export interface UnifiedLoanBookSummary {
  total_requested: number;
  total_paid_capital: number;
  total_paid_interest: number;
  total_interest_debt: number;
  overdue_interest_debt: number;
  current_capital_balance: number;
  total_plan_capital: number;
  total_plan_interest: number;
  total_installment_value: number;
  // Monto desembolsado en los meses que tienen fila.
  total_disbursed_in_rows: number;
}

export interface UnifiedLoanBook {
  rows: UnifiedLoanBookRow[];
  summary: UnifiedLoanBookSummary;
}

function libroDesdeLoanBook(book: LoanBook): Result<LibroDelPrestamo, ErrorDeDominio> {
  const meses: LibroDelPrestamo['meses'] = [];
  for (const m of book.months) {
    const mes = crearFecha(m.due_date.slice(0, 10));
    if (!mes.ok) return mes;
    meses.push({
      numero: m.month_number,
      mes: mes.value,
      capitalPactado: m.plan_capital,
      interesPactado: m.plan_interest,
      cuotaPactada: m.installment_value,
      capitalPagado: m.paid_capital,
      interesPagado: m.paid_interest,
      interesReal: 0,
      interesEnMora: m.interest_debt,
      interesesPendientesAcumulados: m.pending_interest,
      saldoCapitalDespues: m.capital_balance_after,
      esLaProximaCuota: m.is_next_installment,
    });
  }
  const s = book.summary;
  return ok({
    meses,
    resumen: {
      monto: s.requested_amount,
      capitalPagado: s.total_paid_capital,
      interesesPagados: s.total_paid_interest,
      interesesEnMora: s.overdue_interest_debt,
      saldoCapital: s.current_capital_balance,
      capitalPactado: s.total_plan_capital,
      interesPactado: s.total_plan_interest,
      cuotasPactadas: s.total_installment_value,
      proximaCuota: null,
    },
  });
}

// Adapter over the domain `libroUnificado`: it maps the N books (one per
// loan) and their Bogota disbursement dates; the domain adds them up.
export function computeUnifiedLoanBook(
  books: { requested: number; book: LoanBook; disbursedAt: string | null }[],
): Result<UnifiedLoanBook, ErrorDeDominio> {
  const prestamos: Parameters<typeof libroUnificado>[0] = [];
  for (const b of books) {
    const libro = libroDesdeLoanBook(b.book);
    if (!libro.ok) return libro;
    let fecha: FechaISO | null = null;
    if (b.disbursedAt) {
      const f = fechaDeDesembolso(b.disbursedAt);
      if (!f.ok) return f;
      fecha = f.value;
    }
    prestamos.push({ monto: Number(b.requested), fechaDesembolso: fecha, libro: libro.value });
  }
  const { filas, resumen } = libroUnificado(prestamos);
  return ok({
    rows: filas.map((f) => ({
      month_key: f.mes.slice(0, 7),
      due_date: f.mes,
      disbursed_this_month: f.desembolsado,
      plan_capital: f.capitalPactado,
      plan_interest: f.interesPactado,
      installment_value: f.cuotaPactada,
      paid_capital: f.capitalPagado,
      paid_interest: f.interesPagado,
      interest_debt: f.interesEnMora,
      pending_interest: f.interesesPendientesAcumulados,
      capital_balance_after: f.saldoCapitalDespues,
    })),
    summary: {
      total_requested: resumen.monto,
      total_paid_capital: resumen.capitalPagado,
      total_paid_interest: resumen.interesesPagados,
      total_interest_debt: resumen.interesesEnMora,
      overdue_interest_debt: resumen.interesesEnMora,
      current_capital_balance: resumen.saldoCapital,
      total_plan_capital: resumen.capitalPactado,
      total_plan_interest: resumen.interesPactado,
      total_installment_value: resumen.cuotasPactadas,
      total_disbursed_in_rows: resumen.desembolsadoEnLasFilas,
    },
  });
}
