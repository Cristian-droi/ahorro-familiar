// Cart payment: the shareholder picks what to pay and the system shows the
// total to send with the receipt (docs/reglas-negocio.md, RN-4.29b).

import { validarCantidadDeAcciones, type ReglasDeCompra } from '@/modules/acciones/domain/compra';
import { aplicarPago, type PagoAplicado } from '@/modules/prestamos/domain/pagos';
import { ok, err, type Result, type ErrorDeDominio } from '@/shared/domain/result';

export interface MesEnCarrito {
  mes: string;
  acciones: number;
  valorAccion: number;
  // RN-3.4: the fine of this month only, computed by the caller.
  multa: number;
}

export interface PrestamoEnCarrito {
  id: string;
  interesesPendientes: number;
  saldoCapital: number;
  pago: number;
}

export interface MesCobrado {
  mes: string;
  acciones: number;
  valorAcciones: number;
  multa: number;
  subtotal: number;
}

export interface Carrito {
  meses: MesCobrado[];
  prestamos: (PagoAplicado & { id: string })[];
  total: number;
}

const VALOR_INVALIDO: ErrorDeDominio = {
  codigo: 'valor_invalido',
  mensaje: 'El valor de la acción debe ser mayor que cero y la multa no puede ser negativa.',
};

function hayRepetidos(claves: string[]): boolean {
  return new Set(claves).size !== claves.length;
}

export function totalDelCarrito(params: {
  meses: MesEnCarrito[];
  prestamos: PrestamoEnCarrito[];
  reglas: ReglasDeCompra;
}): Result<Carrito, ErrorDeDominio> {
  const { meses, prestamos, reglas } = params;
  if (meses.length === 0 && prestamos.length === 0) {
    return err({ codigo: 'carrito_vacio', mensaje: 'Elige al menos un mes de acciones o un préstamo para pagar.' });
  }
  if (hayRepetidos(meses.map((m) => m.mes))) {
    return err({ codigo: 'mes_repetido', mensaje: 'Cada mes de acciones solo puede estar una vez en el pago.' });
  }
  if (hayRepetidos(prestamos.map((p) => p.id))) {
    return err({ codigo: 'prestamo_repetido', mensaje: 'Cada préstamo solo puede estar una vez en el pago.' });
  }

  const mesesCobrados: MesCobrado[] = [];
  for (const { mes, acciones, valorAccion, multa } of meses) {
    const cantidad = validarCantidadDeAcciones(acciones, reglas);
    if (!cantidad.ok) return cantidad;
    if (!Number.isInteger(valorAccion) || valorAccion <= 0 || !Number.isInteger(multa) || multa < 0) {
      return err(VALOR_INVALIDO);
    }
    const valorAcciones = acciones * valorAccion;
    mesesCobrados.push({ mes, acciones, valorAcciones, multa, subtotal: valorAcciones + multa });
  }

  // RN-4.24 and RN-4.29: each loan, interest first and capital up to the balance.
  const prestamosCobrados: (PagoAplicado & { id: string })[] = [];
  for (const { id, ...prestamo } of prestamos) {
    const aplicado = aplicarPago(prestamo);
    if (!aplicado.ok) return aplicado;
    prestamosCobrados.push({ id, ...aplicado.value });
  }

  const total =
    mesesCobrados.reduce((suma, m) => suma + m.subtotal, 0) + prestamos.reduce((suma, p) => suma + p.pago, 0);
  return ok({ meses: mesesCobrados, prestamos: prestamosCobrados, total });
}
