// Helpers para cálculo de fechas en zona horaria America/Bogota y de multas
// por mora en compra de acciones.
//
// Toda la lógica que toca fechas del dominio (mes actual, primer día de mes,
// días de mora) pasa por aquí para que el servidor no dependa de la TZ donde
// corre Node (Vercel/Railway suelen ser UTC).

const BOGOTA_TZ = 'America/Bogota';

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
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BOGOTA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [year, month, day] = parts.split('-').map(Number);
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
  const today = getBogotaToday();
  return `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-01`;
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

// Calcula la multa por mora para un target_month dado el día de hoy.
// Reglas: multa empieza el día (grace_period_days + 1). Es (days_late * fine_per_day)
// con tope fine_max_per_month.
//
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
export function computeFineDetail(
  targetMonth: string, // "YYYY-MM-01"
  today: Date, // anchor en UTC de día Bogotá
  rules: PurchaseRules,
): { amount: number; daysLate: number; chargedDays: number; capped: boolean } {
  const [year, month] = targetMonth.split('-').map(Number);
  const graceEnd = new Date(Date.UTC(year, month - 1, rules.grace_period_days));

  const diffMs = today.getTime() - graceEnd.getTime();
  const daysLate = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  if (daysLate <= 0) {
    return { amount: 0, daysLate: 0, chargedDays: 0, capped: false };
  }

  const raw = daysLate * rules.fine_per_day;
  const capped = raw > rules.fine_max_per_month;
  const amount = capped ? rules.fine_max_per_month : raw;
  const chargedDays = capped
    ? Math.floor(rules.fine_max_per_month / rules.fine_per_day)
    : daysLate;
  return { amount, daysLate, chargedDays, capped };
}
