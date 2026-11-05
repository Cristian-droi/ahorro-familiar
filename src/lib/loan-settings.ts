import type { TypedSupabaseClient } from './data/types';
import { ok, err, type Result, type ErrorDeDominio } from '@/shared/domain/result';
import {
  calcularAccionesPorPrestamo,
  type AccionesPorPrestamo,
} from '@/modules/prestamos/domain/acciones-por-prestamo';
import { calcularDesembolso, type Desembolso } from '@/modules/prestamos/domain/desembolso';
import type { ReglasDeInteres } from '@/modules/prestamos/domain/intereses';
import {
  AJUSTES_DE_PRESTAMO_POR_DEFECTO,
  validarAjustesDePrestamo,
  validarDiaDeCorte,
  validarDiaLimiteTasaCompleta,
  validarPlazoHastaPeriodoSiguiente,
  type AjustesDePrestamo,
} from '@/modules/parametros/domain/parametros';
import {
  AJUSTE_DIA_DE_CORTE,
  AJUSTE_DIA_LIMITE_TASA_COMPLETA,
  AJUSTE_PLAZO_HASTA_PERIODO_SIGUIENTE,
} from '@/modules/parametros/domain/validar-ajustes';

// Adapter between the legacy loan callers and the loan domain
// (docs/reglas-negocio.md, RN-4.10, RN-4.14 and RN-4.16). It only maps the
// stored settings and loan fields; the rules live in src/modules/prestamos/domain.

// RN-4.10: one share per loan for every 500.000 (⚙️), rounded up.
export const PASO_ACCIONES_POR_PRESTAMO = 500_000;

// RN-4.16: 4x1000 by default, expressed in thousandths.
export const TASA_CUATRO_POR_MIL_POR_DEFECTO = 4;

// `system_settings.four_per_thousand_rate` is stored as a fraction (0.004).
// The domain takes an integer per-mille rate (4), so the conversion happens
// here, once, for every caller. Missing or invalid values use the default.
export function tasaCuatroPorMilDesdeAjuste(valor: unknown): number {
  if (valor === null || valor === undefined || valor === '') return TASA_CUATRO_POR_MIL_POR_DEFECTO;
  const fraccion = Number(valor);
  if (!Number.isFinite(fraccion) || fraccion < 0) return TASA_CUATRO_POR_MIL_POR_DEFECTO;
  return Math.round(fraccion * 1000);
}

// RN-4.18: 2% monthly by default, expressed in basis points.
export const TASA_INTERES_POR_DEFECTO_PUNTOS_BASICOS = 200;

// RN-4.20 (day 15), RN-4.15/RN-4.21 (day 25) and RN-4.3 (terms until December
// of the next period), all ⚙️ in section 10. They live in `system_settings`
// under these keys; missing or invalid values use the section 10 defaults.
export { AJUSTE_DIA_LIMITE_TASA_COMPLETA, AJUSTE_DIA_DE_CORTE, AJUSTE_PLAZO_HASTA_PERIODO_SIGUIENTE };
const CLAVES_DE_AJUSTES_DE_PRESTAMO = [
  AJUSTE_DIA_LIMITE_TASA_COMPLETA,
  AJUSTE_DIA_DE_CORTE,
  AJUSTE_PLAZO_HASTA_PERIODO_SIGUIENTE,
];

export { AJUSTES_DE_PRESTAMO_POR_DEFECTO, type AjustesDePrestamo };

function campoValido<T>(
  clave: string,
  valor: unknown,
  r: Result<T, ErrorDeDominio>,
  porDefecto: T,
  clavesInvalidas: string[],
): T {
  if (valor === undefined || valor === null) return porDefecto;
  if (r.ok) return r.value;
  console.error(`Ajuste ${clave} inválido (${JSON.stringify(valor)}): ${r.error.mensaje} Se usa ${String(porDefecto)}.`);
  clavesInvalidas.push(clave);
  return porDefecto;
}

// The loan settings read from the stored rows, plus the keys whose stored
// value could not be used and are shown as the default (R3-001).
export interface LecturaDeAjustesDePrestamo {
  ajustes: AjustesDePrestamo;
  clavesInvalidas: string[];
}

// Maps the stored rows to the loan settings. Each missing value uses its
// default; an invalid one is logged, reported and uses its default; if the
// days end up inconsistent, every default applies and every stored key is
// reported.
export function leerAjustesDePrestamoDesdeFilas(filas: { key: string; value: unknown }[]): LecturaDeAjustesDePrestamo {
  const valor = (clave: string) => filas.find((f) => f.key === clave)?.value;
  const d = AJUSTES_DE_PRESTAMO_POR_DEFECTO;
  const limite = valor(AJUSTE_DIA_LIMITE_TASA_COMPLETA);
  const corte = valor(AJUSTE_DIA_DE_CORTE);
  const plazo = valor(AJUSTE_PLAZO_HASTA_PERIODO_SIGUIENTE);
  const clavesInvalidas: string[] = [];
  const ajustes = validarAjustesDePrestamo({
    diaLimiteTasaCompleta: campoValido(
      AJUSTE_DIA_LIMITE_TASA_COMPLETA,
      limite,
      validarDiaLimiteTasaCompleta(limite),
      d.diaLimiteTasaCompleta,
      clavesInvalidas,
    ),
    diaDeCorte: campoValido(AJUSTE_DIA_DE_CORTE, corte, validarDiaDeCorte(corte), d.diaDeCorte, clavesInvalidas),
    plazoHastaPeriodoSiguiente: campoValido(
      AJUSTE_PLAZO_HASTA_PERIODO_SIGUIENTE,
      plazo,
      validarPlazoHastaPeriodoSiguiente(plazo),
      d.plazoHastaPeriodoSiguiente,
      clavesInvalidas,
    ),
  });
  if (ajustes.ok) return { ajustes: ajustes.value, clavesInvalidas };
  console.error(`Ajustes de préstamo inválidos: ${ajustes.error.mensaje} Se usan los valores por defecto.`);
  const guardadas = CLAVES_DE_AJUSTES_DE_PRESTAMO.filter((clave) => {
    const v = valor(clave);
    return v !== undefined && v !== null;
  });
  return { ajustes: { ...d }, clavesInvalidas: guardadas };
}

export function ajustesDePrestamoDesdeFilas(filas: { key: string; value: unknown }[]): AjustesDePrestamo {
  return leerAjustesDePrestamoDesdeFilas(filas).ajustes;
}

// The single reader of the loan settings for every caller.
export async function getAjustesDePrestamo(client: TypedSupabaseClient): Promise<AjustesDePrestamo> {
  const { data, error } = await client
    .from('system_settings')
    .select('key, value')
    .in('key', CLAVES_DE_AJUSTES_DE_PRESTAMO);
  // A failed read must not silently fall back to the defaults: a plan saved
  // with the wrong cut-off day would start in the wrong month (RN-4.21).
  if (error) throw new Error(`No se pudieron leer los ajustes de préstamo: ${error.message}`);
  return ajustesDePrestamoDesdeFilas(data ?? []);
}

// The loan fields that decide which days apply to it (RN-4.21b).
export interface DiasGuardadosDelPrestamo {
  disbursed_at: string | null;
  full_rate_day_limit?: number | null;
  cutoff_day?: number | null;
}

// RN-4.21b: the single place that decides which loan settings apply to a loan.
// A disbursed loan always uses the half-rate day limit (RN-4.20) and the
// cut-off day (RN-4.21) stored on it when it was disbursed; a loan that is not
// disbursed yet (requests, plan previews) uses the current settings. A
// disbursed loan without its stored days is a data error, never replaced by
// the current settings.
export function ajustesDelPrestamo(
  prestamo: DiasGuardadosDelPrestamo,
  ajustesActuales: AjustesDePrestamo,
): Result<AjustesDePrestamo, ErrorDeDominio> {
  if (!prestamo.disbursed_at) return ok(ajustesActuales);
  const limite = prestamo.full_rate_day_limit;
  const corte = prestamo.cutoff_day;
  if (limite === null || limite === undefined || corte === null || corte === undefined) {
    return err({
      codigo: 'dias_del_prestamo_faltantes',
      mensaje:
        'El préstamo desembolsado no tiene guardados el día límite de media tasa y el día de corte. Revisá los datos del préstamo.',
    });
  }
  return validarAjustesDePrestamo({
    diaLimiteTasaCompleta: limite,
    diaDeCorte: corte,
    plazoHastaPeriodoSiguiente: ajustesActuales.plazoHastaPeriodoSiguiente,
  });
}

// The loan rate (`system_settings.default_loan_interest_rate`,
// `loans.interest_rate`) is stored as a fraction (0.02). The domain takes
// integer basis points (200), so the conversion happens here, once, for every
// caller.
function fraccionValida(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const fraccion = Number(valor);
  return Number.isFinite(fraccion) && fraccion >= 0 ? fraccion : null;
}

// Global setting: missing or invalid values use the default 2%.
export function tasaEnPuntosBasicosDesdeAjuste(valor: unknown): number {
  const fraccion = fraccionValida(valor);
  // RN-4.18: unit conversion of the rate (fraction to basis points), not money.
  return fraccion === null ? TASA_INTERES_POR_DEFECTO_PUNTOS_BASICOS : Math.round(fraccion * 10000);
}

// Global setting as the fraction stored in a new loan: missing or invalid
// values use the default 2%.
export function tasaDeInteresGlobalDesdeAjuste(valor: unknown): number {
  return fraccionValida(valor) ?? TASA_INTERES_POR_DEFECTO_PUNTOS_BASICOS / 10000;
}

// The global rate setting: ajustes saves `default_loan_interest_rate`; older
// data may only have `loan_interest_rate`. Same precedence as POST /api/prestamos.
export async function getTasaDeInteresGlobal(client: TypedSupabaseClient): Promise<number> {
  const { data, error } = await client
    .from('system_settings')
    .select('key, value')
    .in('key', ['default_loan_interest_rate', 'loan_interest_rate']);
  if (error) throw new Error(`No se pudo leer la tasa de interés: ${error.message}`);
  const porClave = new Map((data ?? []).map((fila) => [fila.key, fila.value]));
  return tasaDeInteresGlobalDesdeAjuste(porClave.get('default_loan_interest_rate') ?? porClave.get('loan_interest_rate'));
}

// A loan's own stored rate never falls back to the default: a missing or
// invalid `loans.interest_rate` is an error the caller reports.
export function tasaEnPuntosBasicosDelPrestamo(valor: unknown): Result<number, ErrorDeDominio> {
  const fraccion = fraccionValida(valor);
  if (fraccion === null) {
    return err({
      codigo: 'tasa_invalida',
      mensaje: 'El préstamo no tiene una tasa de interés válida. Revisá la tasa guardada.',
    });
  }
  // RN-4.18: unit conversion of the rate (fraction to basis points), not money.
  return ok(Math.round(fraccion * 10000));
}

export function reglasDeInteresDelPrestamo(
  tasa: unknown,
  ajustes: AjustesDePrestamo = AJUSTES_DE_PRESTAMO_POR_DEFECTO,
): Result<ReglasDeInteres, ErrorDeDominio> {
  const puntos = tasaEnPuntosBasicosDelPrestamo(tasa);
  if (!puntos.ok) return puntos;
  return ok({
    tasaEnPuntosBasicos: puntos.value,
    diaLimiteTasaCompleta: ajustes.diaLimiteTasaCompleta,
    diaDeCorte: ajustes.diaDeCorte,
  });
}

export function reglasDeInteresDesdeAjuste(
  tasa: unknown,
  ajustes: AjustesDePrestamo = AJUSTES_DE_PRESTAMO_POR_DEFECTO,
): ReglasDeInteres {
  return {
    tasaEnPuntosBasicos: tasaEnPuntosBasicosDesdeAjuste(tasa),
    diaLimiteTasaCompleta: ajustes.diaLimiteTasaCompleta,
    diaDeCorte: ajustes.diaDeCorte,
  };
}

export async function getTasaCuatroPorMil(client: TypedSupabaseClient): Promise<number> {
  const { data } = await client
    .from('system_settings')
    .select('value')
    .eq('key', 'four_per_thousand_rate')
    .maybeSingle();
  return tasaCuatroPorMilDesdeAjuste(data?.value);
}

export function accionesPorPrestamo(
  monto: number,
  valorAccion: number,
): Result<AccionesPorPrestamo, ErrorDeDominio> {
  return calcularAccionesPorPrestamo({ monto, valorAccion, paso: PASO_ACCIONES_POR_PRESTAMO });
}

// Maps the loan fields to the domain deductions. Loan shares are deducted
// only when they are not paid upfront (RN-4.14); overdue shares are added to
// the same share deduction.
export function desembolsoDePrestamo(params: {
  monto: number;
  accionesPorPrestamo: number;
  pagadasPorAdelantado: boolean;
  accionesVencidas: number;
  multas: number;
  intereses: number;
  capital: number;
  tasaPorMil: number;
}): Result<Desembolso, ErrorDeDominio> {
  const accionesDescontadas = params.pagadasPorAdelantado ? 0 : params.accionesPorPrestamo;
  return calcularDesembolso({
    monto: params.monto,
    deducciones: {
      acciones: accionesDescontadas + params.accionesVencidas,
      multas: params.multas,
      intereses: params.intereses,
      capital: params.capital,
    },
    tasaPorMil: params.tasaPorMil,
  });
}
