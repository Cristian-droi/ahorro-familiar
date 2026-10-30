import type { TypedSupabaseClient } from './data/types';
import { ok, err, type Result, type ErrorDeDominio } from '@/shared/domain/result';
import {
  calcularAccionesPorPrestamo,
  type AccionesPorPrestamo,
} from '@/modules/prestamos/domain/acciones-por-prestamo';
import { calcularDesembolso, type Desembolso } from '@/modules/prestamos/domain/desembolso';
import type { ReglasDeInteres } from '@/modules/prestamos/domain/intereses';

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

// RN-4.20 and RN-4.15 (⚙️ in section 10). There is no `system_settings` key
// for them yet, so the documented defaults apply.
export const DIA_LIMITE_TASA_COMPLETA_POR_DEFECTO = 15;
export const DIA_DE_CORTE_POR_DEFECTO = 25;

// RN-4.3: "Permitir plazo hasta diciembre del año siguiente" defaults to no.
// There is no setting for it yet, so every term runs until December of the
// applied month's period.
export const PLAZO_HASTA_PERIODO_SIGUIENTE_POR_DEFECTO = false;

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

export function reglasDeInteresDelPrestamo(tasa: unknown): Result<ReglasDeInteres, ErrorDeDominio> {
  const puntos = tasaEnPuntosBasicosDelPrestamo(tasa);
  if (!puntos.ok) return puntos;
  return ok({
    tasaEnPuntosBasicos: puntos.value,
    diaLimiteTasaCompleta: DIA_LIMITE_TASA_COMPLETA_POR_DEFECTO,
    diaDeCorte: DIA_DE_CORTE_POR_DEFECTO,
  });
}

export function reglasDeInteresDesdeAjuste(tasa: unknown): ReglasDeInteres {
  return {
    tasaEnPuntosBasicos: tasaEnPuntosBasicosDesdeAjuste(tasa),
    diaLimiteTasaCompleta: DIA_LIMITE_TASA_COMPLETA_POR_DEFECTO,
    diaDeCorte: DIA_DE_CORTE_POR_DEFECTO,
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
