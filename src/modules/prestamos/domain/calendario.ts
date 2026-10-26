// Loan calendar: applied month and term (docs/reglas-negocio.md, RN-4.15 and RN-4.3).

import {
  diaDelMes,
  diciembreDelAnio,
  mesSiguiente,
  mesesEntre,
  primerDiaDelMes,
  sumarMeses,
  type FechaISO,
} from '@/shared/domain/fechas';

// RN-4.15: a disbursement after the cut-off day (⚙️, 25 by default) counts
// as a loan of the next month. Returns the first day of the applied month.
export function mesAplicado(fechaDesembolso: FechaISO, diaDeCorte: number): FechaISO {
  return diaDelMes(fechaDesembolso) > diaDeCorte ? mesSiguiente(fechaDesembolso) : primerDiaDelMes(fechaDesembolso);
}

export interface Plazo {
  meses: number;
  // First day of the last month of the term (always a December).
  mesFinal: FechaISO;
}

// RN-4.3: by default the term runs until December of the applied month's
// period. The admin can allow (⚙️) terms until December of the next period.
export function plazoDelPrestamo(params: { mesAplicado: FechaISO; hastaPeriodoSiguiente: boolean }): Plazo {
  const { mesAplicado: inicio, hastaPeriodoSiguiente } = params;
  const diciembre = diciembreDelAnio(inicio);
  const mesFinal = hastaPeriodoSiguiente ? sumarMeses(diciembre, 12) : diciembre;
  return { meses: mesesEntre(inicio, mesFinal) + 1, mesFinal };
}
