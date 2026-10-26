// Installment to close the year (docs/reglas-negocio.md, section 4.7 and RN-4.30).
// The pace the admin sees to bring a loan to zero by the end of its term.

import { mesesEntre, type FechaISO } from '@/shared/domain/fechas';
import { ok, err, type Result, type ErrorDeDominio } from '@/shared/domain/result';

export function cuotaParaCerrarElAnio(params: {
  saldo: number;
  mesActual: FechaISO;
  // Last month of the loan term, from `plazoDelPrestamo` (December of the
  // period, or of the next one for extended terms).
  mesFinal: FechaISO;
}): Result<number, ErrorDeDominio> {
  const { saldo, mesActual, mesFinal } = params;
  if (!Number.isInteger(saldo) || saldo < 0) {
    return err({ codigo: 'saldo_invalido', mensaje: 'El saldo del préstamo debe ser un número entero no negativo.' });
  }

  // Remaining months until the end of the term, including the current one.
  const mesesRestantes = mesesEntre(mesActual, mesFinal) + 1;
  if (mesesRestantes < 1) {
    return err({
      codigo: 'fuera_del_plazo',
      mensaje: 'El mes actual es posterior al último mes del plazo del préstamo.',
    });
  }

  // RN-4.30: round up so the suggested pace reaches zero by the last month.
  return ok(Math.ceil(saldo / mesesRestantes));
}
