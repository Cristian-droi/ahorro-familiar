// Validation of a batch of `system_settings` rows the admin saves from the
// ajustes page (docs/reglas-negocio.md, section 10 ⚙️). Pure: it takes the
// incoming rows and the stored ones, and returns the typed rows to store or
// the first Spanish error. Only the keys the ajustes page edits are accepted.

import { ok, err, type Result, type ErrorDeDominio } from '@/shared/domain/result';
import {
  AJUSTES_DE_PRESTAMO_POR_DEFECTO,
  validarAjustesDePrestamo,
  validarDiaDeCorte,
  validarDiaLimiteTasaCompleta,
  validarFraccion,
  validarMaximoDePrestamosActivos,
  validarPlazoHastaPeriodoSiguiente,
  validarValoresDeAccion,
} from './parametros';

// RN-4.20, RN-4.15/RN-4.21 and RN-4.3: the loan settings keys.
export const AJUSTE_DIA_LIMITE_TASA_COMPLETA = 'loan_full_rate_day_limit';
export const AJUSTE_DIA_DE_CORTE = 'loan_cutoff_day';
export const AJUSTE_PLAZO_HASTA_PERIODO_SIGUIENTE = 'loan_extended_term_enabled';

export interface FilaDeAjuste {
  key: string;
  value: unknown;
}

function siONo(nombre: string, codigo: string) {
  return (valor: unknown): Result<boolean, ErrorDeDominio> =>
    typeof valor === 'boolean' ? ok(valor) : err({ codigo, mensaje: `${nombre} debe ser sí o no.` });
}

// One validator per editable key. Fractions are stored as 0–1.
const VALIDADORES: Record<string, (valor: unknown) => Result<unknown, ErrorDeDominio>> = {
  allowed_share_values: validarValoresDeAccion,
  resumen_expenses_percentage: (v) => validarFraccion(v, 'El porcentaje de gastos'),
  resumen_next_year_shares_percentage: (v) => validarFraccion(v, 'El porcentaje de acciones del siguiente año'),
  next_year_capitalization_active: siONo('La capitalización del próximo año', 'capitalizacion_invalida'),
  four_per_thousand_rate: (v) => validarFraccion(v, 'El gravamen 4×1000'),
  default_loan_interest_rate: (v) => validarFraccion(v, 'La tasa de interés'),
  max_active_loans_enabled: siONo('El límite de préstamos activos', 'limite_de_prestamos_invalido'),
  max_active_loans_per_user: validarMaximoDePrestamosActivos,
  [AJUSTE_DIA_LIMITE_TASA_COMPLETA]: validarDiaLimiteTasaCompleta,
  [AJUSTE_DIA_DE_CORTE]: validarDiaDeCorte,
  [AJUSTE_PLAZO_HASTA_PERIODO_SIGUIENTE]: validarPlazoHastaPeriodoSiguiente,
};

export const CLAVES_DE_AJUSTES_EDITABLES: readonly string[] = Object.keys(VALIDADORES);

// The stored value of a day, or its default when it is missing or invalid
// (the same fallback the loan settings reader applies).
function diaGuardado(
  guardados: FilaDeAjuste[],
  clave: string,
  validar: (valor: unknown) => Result<number, ErrorDeDominio>,
  porDefecto: number,
): number {
  const r = validar(guardados.find((f) => f.key === clave)?.value);
  return r.ok ? r.value : porDefecto;
}

export function validarAjustesAGuardar(
  entrantes: FilaDeAjuste[],
  guardados: FilaDeAjuste[],
): Result<FilaDeAjuste[], ErrorDeDominio> {
  if (entrantes.length === 0) {
    return err({ codigo: 'sin_ajustes', mensaje: 'No hay ajustes para guardar.' });
  }
  const validados: FilaDeAjuste[] = [];
  for (const { key, value } of entrantes) {
    const validar = Object.hasOwn(VALIDADORES, key) ? VALIDADORES[key] : undefined;
    if (!validar) {
      return err({
        codigo: 'ajuste_no_editable',
        mensaje: `El ajuste "${key}" no se puede modificar desde esta pantalla.`,
      });
    }
    if (validados.some((f) => f.key === key)) {
      return err({ codigo: 'ajuste_repetido', mensaje: `El ajuste "${key}" está repetido.` });
    }
    const r = validar(value);
    if (!r.ok) return r;
    validados.push({ key, value: r.value });
  }

  // RN-4.21: the half-rate day limit must be before the cut-off day. A day
  // that is not sent keeps its stored value.
  const limiteEntrante = validados.find((f) => f.key === AJUSTE_DIA_LIMITE_TASA_COMPLETA);
  const corteEntrante = validados.find((f) => f.key === AJUSTE_DIA_DE_CORTE);
  if (limiteEntrante || corteEntrante) {
    const d = AJUSTES_DE_PRESTAMO_POR_DEFECTO;
    const limite = limiteEntrante
      ? (limiteEntrante.value as number)
      : diaGuardado(guardados, AJUSTE_DIA_LIMITE_TASA_COMPLETA, validarDiaLimiteTasaCompleta, d.diaLimiteTasaCompleta);
    const corte = corteEntrante
      ? (corteEntrante.value as number)
      : diaGuardado(guardados, AJUSTE_DIA_DE_CORTE, validarDiaDeCorte, d.diaDeCorte);
    // Both days are already valid, so only the cross-field check can fail.
    const dias = validarAjustesDePrestamo({
      diaLimiteTasaCompleta: limite,
      diaDeCorte: corte,
      plazoHastaPeriodoSiguiente: d.plazoHastaPeriodoSiguiente,
    });
    if (!dias.ok) return dias;
  }
  return ok(validados);
}
