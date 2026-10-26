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
