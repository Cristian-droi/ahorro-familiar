// Monthly share purchase limits (docs/reglas-negocio.md, RN-3.1).

import { ok, err, type Result, type ErrorDeDominio } from '@/shared/domain/result';

// Configurable parameters (docs/reglas-negocio.md, section 10).
export interface ReglasDeCompra {
  minAccionesPorMes: number;
  maxAccionesPorMes: number;
}

export function validarCantidadDeAcciones(
  cantidad: number,
  reglas: ReglasDeCompra,
): Result<number, ErrorDeDominio> {
  if (!Number.isInteger(cantidad)) {
    return err({ codigo: 'cantidad_no_entera', mensaje: 'La cantidad de acciones debe ser un número entero.' });
  }
  if (cantidad < reglas.minAccionesPorMes || cantidad > reglas.maxAccionesPorMes) {
    return err({
      codigo: 'cantidad_fuera_de_rango',
      mensaje: `Puedes comprar entre ${reglas.minAccionesPorMes} y ${reglas.maxAccionesPorMes} acciones por mes.`,
    });
  }
  return ok(cantidad);
}
