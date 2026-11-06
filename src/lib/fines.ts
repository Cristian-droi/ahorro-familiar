// Legacy adapter for Bogota dates and late-purchase fines.
//
// The fine rule (docs/reglas-negocio.md, RN-3.4) lives in
// src/modules/acciones/domain/multas.ts; this file only maps the stored
// `PurchaseRules` and the legacy `Date` anchors to the domain types. It is
// also the clock edge of the legacy layer: `new Date()` is read here, never in
// the domain.

import { detalleDeMulta, type ReglasDeMulta } from '@/modules/acciones/domain/multas';
import { hoyBogota, primerDiaDelMes, type FechaISO } from '@/shared/domain/fechas';

export interface PurchaseRules {
  min_shares_per_month: number;
  max_shares_per_month: number;
  fine_per_day: number;
  fine_max_per_month: number;
  grace_period_days: number;
}

export const DEFAULT_PURCHASE_RULES: PurchaseRules = {
  min_shares_per_month: 1,
  max_shares_per_month: 10,
  fine_per_day: 500,
  fine_max_per_month: 15000,
  grace_period_days: 10,
};

// Devuelve la fecha "de hoy" en Bogotá como un Date ancla en UTC. La
// representación es siempre medianoche UTC del día calendario Bogotá para
// que las operaciones de días sean enteras, sin DST (Colombia no tiene DST).
export function getBogotaToday(): Date {
  const [year, month, day] = hoyBogota(new Date()).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

// "YYYY-MM-DD" del día Bogotá.
export function formatBogotaDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Primer día del mes actual en Bogotá ("YYYY-MM-01").
export function getBogotaCurrentMonth(): string {
  return primerDiaDelMes(hoyBogota(new Date()));
}

// Devuelve el primer día de cada mes del año en curso Bogotá que sea >= desde
// el mes indicado. Útil para armar dropdowns del selector de target_month.
export function listMonthsUpToDecember(
  fromMonth: string,
): Array<{ value: string; label: string; monthIndex: number }> {
  const [fromYear, fromMonthNum] = fromMonth.split('-').map(Number);
  const months: Array<{ value: string; label: string; monthIndex: number }> = [];
  const monthNames = [
    'Enero',
    'Febrero',
    'Marzo',
    'Abril',
    'Mayo',
    'Junio',
    'Julio',
    'Agosto',
    'Septiembre',
    'Octubre',
    'Noviembre',
    'Diciembre',
  ];
  for (let m = fromMonthNum; m <= 12; m++) {
    const value = `${fromYear}-${String(m).padStart(2, '0')}-01`;
    months.push({ value, label: monthNames[m - 1], monthIndex: m });
  }
  return months;
}

// Devuelve todos los meses del año en curso, desde enero hasta diciembre,
// marcando cuáles están "cerrados para compra" (ninguno, porque permitimos
// todo el año en curso). Útil para el Extracto.
export function listAllMonthsOfYear(
  year: number,
): Array<{ value: string; label: string; monthIndex: number }> {
  return listMonthsUpToDecember(`${year}-01-01`);
}

// Maps the stored purchase rules to the domain fine rules (RN-3.4).
export function toReglasDeMulta(rules: PurchaseRules): ReglasDeMulta {
  return {
    diasDeGracia: rules.grace_period_days,
    multaPorDia: rules.fine_per_day,
    topeMensual: rules.fine_max_per_month,
  };
}

// Calcula la multa por mora de un target_month al día de hoy (RN-3.4).
// `today` y `targetMonth` se comparan como fechas calendario Bogotá.
export function computeFineForMonth(
  targetMonth: string, // "YYYY-MM-01"
  today: Date, // anchor en UTC de día Bogotá
  rules: PurchaseRules,
): number {
  return computeFineDetail(targetMonth, today, rules).amount;
}

// Variante que también devuelve cuántos días en mora se están cobrando y
// si llegó al tope. Útil para mostrar la info en la UI sin recalcular.
// El monto y los días salen de `detalleDeMulta` (RN-3.4).
export function computeFineDetail(
  targetMonth: string, // "YYYY-MM-01"
  today: Date, // anchor en UTC de día Bogotá
  rules: PurchaseRules,
): { amount: number; daysLate: number; chargedDays: number; capped: boolean } {
  const mes = primerDiaDelMes(targetMonth as FechaISO);
  const hoy = formatBogotaDate(today) as FechaISO;
  const detalle = detalleDeMulta({ mes, hoy, reglas: toReglasDeMulta(rules) });
  if (detalle.monto <= 0) {
    return { amount: 0, daysLate: 0, chargedDays: 0, capped: false };
  }
  return {
    amount: detalle.monto,
    daysLate: detalle.diasDeMora,
    chargedDays: detalle.diasCobrados,
    capped: detalle.topado,
  };
}
