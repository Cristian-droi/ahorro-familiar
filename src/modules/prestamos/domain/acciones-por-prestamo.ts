// Shares required per loan (docs/reglas-negocio.md, RN-4.10 and RN-4.14).

import { ok, err, type Result, type ErrorDeDominio } from '@/shared/domain/result';

export interface AccionesPorPrestamo {
  cantidad: number;
  valor: number;
}

export function calcularAccionesPorPrestamo(params: {
  monto: number;
  valorAccion: number;
  // Configurable step (⚙️), 500.000 by default.
  paso: number;
}): Result<AccionesPorPrestamo, ErrorDeDominio> {
  const { monto, valorAccion, paso } = params;
  if (!Number.isInteger(monto) || monto <= 0) {
    return err({
      codigo: 'monto_invalido',
      mensaje: 'El monto del préstamo debe ser un número entero mayor que cero.',
    });
  }

  // RN-4.10: CEILING(amount / step), with no upper limit.
  const cantidad = Math.ceil(monto / paso);
  // RN-4.14: each share is worth the shareholder's share value for the period.
  return ok({ cantidad, valor: cantidad * valorAccion });
}

// RN-4.12: when approving the request the administrator may change the count.
// A change needs a reason; the value follows the shareholder's share value
// (RN-4.14).
export function ajustarAccionesPorPrestamo(params: {
  sugerida: number;
  final: number;
  valorAccion: number;
  motivo: string | null | undefined;
}): Result<AccionesPorPrestamo & { cambio: boolean }, ErrorDeDominio> {
  const { sugerida, final, valorAccion } = params;
  if (!Number.isInteger(final) || final < 0) {
    return err({
      codigo: 'cantidad_invalida',
      mensaje: 'La cantidad de acciones por préstamo debe ser un número entero de cero o más.',
    });
  }
  const cambio = final !== sugerida;
  if (cambio && !(params.motivo ?? '').trim()) {
    return err({
      codigo: 'motivo_obligatorio',
      mensaje: 'Para cambiar las acciones por préstamo debes indicar el motivo.',
    });
  }
  return ok({ cantidad: final, valor: final * valorAccion, cambio });
}
