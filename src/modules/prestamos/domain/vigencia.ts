// Validity of a loan request (docs/reglas-negocio.md, RN-4.5b).

import { diasEntre, type FechaISO } from '@/shared/domain/fechas';

// RN-4.5b: a request expires when more than 15 days pass from its submission
// (it leaves draft) without a disbursement.
export const DIAS_DE_VIGENCIA_DE_SOLICITUD = 15;

// RN-4.5b: true when more than `diasDeVigencia` calendar days have passed from
// the day the request was sent. Day 15 is still valid; day 16 is expired.
export function solicitudVencida(params: { enviadaEl: FechaISO; hoy: FechaISO; diasDeVigencia: number }): boolean {
  return diasEntre(params.enviadaEl, params.hoy) > params.diasDeVigencia;
}
