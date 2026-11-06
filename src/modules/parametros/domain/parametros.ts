// Validation of the configurable parameters (docs/reglas-negocio.md, section
// 10 ⚙️) as they are stored in `system_settings` (key/jsonb). Pure functions:
// each takes the raw stored value and returns it typed, or a Spanish message.
// Where the rules give no range, the bound is the minimal technical one.

import { ok, err, type Result, type ErrorDeDominio } from '@/shared/domain/result';

// RN-4.20, RN-4.15/RN-4.21 and RN-4.3 (⚙️).
export interface AjustesDePrestamo {
  // RN-4.20: after this day the first month pays half rate.
  diaLimiteTasaCompleta: number;
  // RN-4.15/RN-4.21: after this day the loan counts from the next month.
  diaDeCorte: number;
  // RN-4.3: the admin enables, for everyone, terms until December of the next period.
  plazoHastaPeriodoSiguiente: boolean;
}

// Section 10 defaults.
export const AJUSTES_DE_PRESTAMO_POR_DEFECTO: AjustesDePrestamo = {
  diaLimiteTasaCompleta: 15,
  diaDeCorte: 25,
  plazoHastaPeriodoSiguiente: false,
};

// Every month has at least 28 days, so a day of month is 1–28.
const ULTIMO_DIA_DE_TODOS_LOS_MESES = 28;

function entero(valor: unknown): number | null {
  if (typeof valor === 'boolean' || valor === null || valor === undefined || valor === '') return null;
  const n = typeof valor === 'string' ? Number(valor) : valor;
  return typeof n === 'number' && Number.isInteger(n) ? n : null;
}

function numero(valor: unknown): number | null {
  if (typeof valor === 'boolean' || valor === null || valor === undefined || valor === '') return null;
  const n = typeof valor === 'string' ? Number(valor) : valor;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function enteroEntre(
  valor: unknown,
  min: number,
  max: number,
  error: ErrorDeDominio,
): Result<number, ErrorDeDominio> {
  const n = entero(valor);
  return n !== null && n >= min && n <= max ? ok(n) : err(error);
}

// RN-4.20. The limit must be before the cut-off day (see validarAjustesDePrestamo),
// so it ends at 27.
export function validarDiaLimiteTasaCompleta(valor: unknown): Result<number, ErrorDeDominio> {
  const max = ULTIMO_DIA_DE_TODOS_LOS_MESES - 1;
  return enteroEntre(valor, 1, max, {
    codigo: 'dia_limite_invalido',
    mensaje: `El día límite para la tasa completa debe ser un número entero entre 1 y ${max}.`,
  });
}

// RN-4.15/RN-4.21. It must be after the day limit, so it starts at 2.
export function validarDiaDeCorte(valor: unknown): Result<number, ErrorDeDominio> {
  return enteroEntre(valor, 2, ULTIMO_DIA_DE_TODOS_LOS_MESES, {
    codigo: 'dia_de_corte_invalido',
    mensaje: `El día de corte debe ser un número entero entre 2 y ${ULTIMO_DIA_DE_TODOS_LOS_MESES}.`,
  });
}

// RN-4.3.
export function validarPlazoHastaPeriodoSiguiente(valor: unknown): Result<boolean, ErrorDeDominio> {
  if (typeof valor === 'boolean') return ok(valor);
  return err({
    codigo: 'plazo_extendido_invalido',
    mensaje: 'El plazo hasta diciembre del periodo siguiente debe ser sí o no.',
  });
}

// RN-4.21: half rate runs from the day after the limit up to the cut-off day,
// so the limit must be before the cut-off day.
export function validarAjustesDePrestamo(valores: {
  diaLimiteTasaCompleta: unknown;
  diaDeCorte: unknown;
  plazoHastaPeriodoSiguiente: unknown;
}): Result<AjustesDePrestamo, ErrorDeDominio> {
  const limite = validarDiaLimiteTasaCompleta(valores.diaLimiteTasaCompleta);
  if (!limite.ok) return limite;
  const corte = validarDiaDeCorte(valores.diaDeCorte);
  if (!corte.ok) return corte;
  const plazo = validarPlazoHastaPeriodoSiguiente(valores.plazoHastaPeriodoSiguiente);
  if (!plazo.ok) return plazo;
  if (limite.value >= corte.value) {
    return err({
      codigo: 'dias_de_prestamo_inconsistentes',
      mensaje: `El día límite para la tasa completa (${limite.value}) debe ser menor que el día de corte (${corte.value}).`,
    });
  }
  return ok({
    diaLimiteTasaCompleta: limite.value,
    diaDeCorte: corte.value,
    plazoHastaPeriodoSiguiente: plazo.value,
  });
}

// Rates and percentages stored as a fraction (RN-4.16 4x1000, RN-4.18 loan
// rate, section 10 yearly expense and next-period retention): 0 to 1.
export function validarFraccion(valor: unknown, nombre: string): Result<number, ErrorDeDominio> {
  const n = numero(valor);
  if (n !== null && n >= 0 && n <= 1) return ok(n);
  return err({ codigo: 'fraccion_invalida', mensaje: `${nombre} debe estar entre 0% y 100%.` });
}

// `allowed_share_values`: a non-empty list of distinct whole positive pesos.
export function validarValoresDeAccion(valor: unknown): Result<number[], ErrorDeDominio> {
  const error = err({
    codigo: 'valores_de_accion_invalidos',
    mensaje: 'Los valores de acción permitidos deben ser una lista de valores enteros mayores que 0, sin repetir.',
  });
  if (!Array.isArray(valor) || valor.length === 0) return error;
  const valores: number[] = [];
  for (const v of valor) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0 || valores.includes(v)) return error;
    valores.push(v);
  }
  return ok([...valores].sort((a, b) => a - b));
}

// `purchase_rules` (RN-3.1, RN-3.4), stored with these snake_case fields.
export interface ReglasDeCompraGuardadas {
  min_shares_per_month: number;
  max_shares_per_month: number;
  fine_per_day: number;
  fine_max_per_month: number;
  grace_period_days: number;
}

const CAMPOS_DE_COMPRA: { campo: keyof ReglasDeCompraGuardadas; nombre: string; min: number; max: number }[] = [
  { campo: 'min_shares_per_month', nombre: 'El mínimo de acciones por mes', min: 1, max: Number.MAX_SAFE_INTEGER },
  { campo: 'max_shares_per_month', nombre: 'El máximo de acciones por mes', min: 1, max: Number.MAX_SAFE_INTEGER },
  { campo: 'fine_per_day', nombre: 'La multa por día', min: 0, max: Number.MAX_SAFE_INTEGER },
  { campo: 'fine_max_per_month', nombre: 'El tope de multa mensual', min: 0, max: Number.MAX_SAFE_INTEGER },
  { campo: 'grace_period_days', nombre: 'Los días de gracia', min: 0, max: ULTIMO_DIA_DE_TODOS_LOS_MESES },
];

export function validarReglasDeCompra(valor: unknown): Result<ReglasDeCompraGuardadas, ErrorDeDominio> {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) {
    return err({ codigo: 'reglas_de_compra_invalidas', mensaje: 'Las reglas de compra no tienen un formato válido.' });
  }
  const crudo = valor as Record<string, unknown>;
  const reglas = {} as ReglasDeCompraGuardadas;
  for (const { campo, nombre, min, max } of CAMPOS_DE_COMPRA) {
    const v = crudo[campo];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
      const rango = max === Number.MAX_SAFE_INTEGER ? `de al menos ${min}` : `entre ${min} y ${max}`;
      return err({ codigo: 'reglas_de_compra_invalidas', mensaje: `${nombre} debe ser un número entero ${rango}.` });
    }
    reglas[campo] = v;
  }
  if (reglas.min_shares_per_month > reglas.max_shares_per_month) {
    return err({
      codigo: 'reglas_de_compra_invalidas',
      mensaje: `El mínimo de acciones por mes (${reglas.min_shares_per_month}) no puede ser mayor que el máximo (${reglas.max_shares_per_month}).`,
    });
  }
  return ok(reglas);
}

// `max_active_loans_per_user` (RN-4.2, optional): a whole number of at least 1.
export function validarMaximoDePrestamosActivos(valor: unknown): Result<number, ErrorDeDominio> {
  const n = typeof valor === 'number' && Number.isInteger(valor) ? valor : null;
  if (n !== null && n >= 1) return ok(n);
  return err({
    codigo: 'maximo_de_prestamos_invalido',
    mensaje: 'El máximo de préstamos activos debe ser un número entero de al menos 1.',
  });
}
