// Fixed-amount payment: the shareholder sends an amount and the system splits
// it in a fixed order (docs/reglas-negocio.md, RN-4.29c).

import type { ReglasDeCompra } from '@/modules/acciones/domain/compra';
import { ok, err, type Result, type ErrorDeDominio } from '@/shared/domain/result';
import { hayRepetidos } from './repetidos';

export interface PrestamoPendiente {
  id: string;
  interesesPendientes: number;
  saldoCapital: number;
}

export interface MesPendiente {
  mes: string;
  valorAccion: number;
  // RN-3.4: the fine of this month only, computed by the caller.
  multa: number;
}

export interface Distribucion {
  intereses: { id: string; monto: number }[];
  meses: { mes: string; acciones: number; valorAcciones: number; multa: number }[];
  capital: { id: string; monto: number; saldoRestante: number }[];
  mesesFuturos: { mes: string; acciones: number; valorAcciones: number }[];
  // Not applied: the shareholder sends the amount minus this.
  rechazado: number;
}

function esEnteroNoNegativo(valor: number): boolean {
  return Number.isInteger(valor) && valor >= 0;
}

function esValorDeAccionValido(valor: number): boolean {
  return Number.isInteger(valor) && valor > 0;
}

export function distribuirMontoFijo(params: {
  monto: number;
  // In the order the shareholder chose for capital (RN-4.29).
  prestamos: PrestamoPendiente[];
  // From the oldest month to the most recent.
  mesesAtrasados: MesPendiente[];
  mesActual: MesPendiente | null;
  // The future months that can still be bought, in order.
  mesesFuturos: { mes: string; valorAccion: number }[];
  adelantarAcciones: boolean;
  reglas: ReglasDeCompra;
}): Result<Distribucion, ErrorDeDominio> {
  const { monto, prestamos, mesesAtrasados, mesActual, mesesFuturos, adelantarAcciones, reglas } = params;
  if (!Number.isInteger(monto) || monto <= 0) {
    return err({ codigo: 'pago_invalido', mensaje: 'El pago debe ser un número entero mayor que cero.' });
  }
  const meses = mesActual ? [...mesesAtrasados, mesActual] : mesesAtrasados;
  if (
    prestamos.some((p) => !esEnteroNoNegativo(p.interesesPendientes) || !esEnteroNoNegativo(p.saldoCapital)) ||
    meses.some((m) => !esValorDeAccionValido(m.valorAccion) || !esEnteroNoNegativo(m.multa)) ||
    mesesFuturos.some((m) => !esValorDeAccionValido(m.valorAccion))
  ) {
    return err({
      codigo: 'valor_invalido',
      mensaje: 'Los saldos, intereses y multas deben ser enteros no negativos, y el valor de la acción mayor que cero.',
    });
  }

  if (hayRepetidos(prestamos.map((p) => p.id))) {
    return err({ codigo: 'prestamo_repetido', mensaje: 'Cada préstamo solo puede estar una vez en el pago.' });
  }
  if (hayRepetidos([...meses, ...mesesFuturos].map((m) => m.mes))) {
    return err({ codigo: 'mes_repetido', mensaje: 'Cada mes de acciones solo puede estar una vez en el pago.' });
  }

  // RN-3.1: one month means the minimum shares.
  const acciones = reglas.minAccionesPorMes;
  const distribucion: Distribucion = { intereses: [], meses: [], capital: [], mesesFuturos: [], rechazado: 0 };
  let restante = monto;

  // 1. Interest of every loan, partial payments allowed (RN-4.25).
  for (const { id, interesesPendientes } of prestamos) {
    const parte = Math.min(restante, interesesPendientes);
    if (parte > 0) distribucion.intereses.push({ id, monto: parte });
    restante -= parte;
  }

  // 2 and 3. Overdue months from the oldest, then the current month, each one
  // whole with its own fine. A month the amount cannot cover stops the split.
  for (const { mes, valorAccion, multa } of meses) {
    const valorAcciones = acciones * valorAccion;
    if (restante < valorAcciones + multa) {
      return ok({ ...distribucion, rechazado: restante });
    }
    distribucion.meses.push({ mes, acciones, valorAcciones, multa });
    restante -= valorAcciones + multa;
  }

  // 4. Capital in the order the shareholder chose (RN-4.29).
  for (const { id, saldoCapital } of prestamos) {
    const parte = Math.min(restante, saldoCapital);
    if (parte > 0) distribucion.capital.push({ id, monto: parte, saldoRestante: saldoCapital - parte });
    restante -= parte;
  }

  // 5. Nothing is pending: whole future months only, the rest is rejected.
  if (adelantarAcciones) {
    for (const { mes, valorAccion } of mesesFuturos) {
      const valorAcciones = acciones * valorAccion;
      if (restante < valorAcciones) break;
      distribucion.mesesFuturos.push({ mes, acciones, valorAcciones });
      restante -= valorAcciones;
    }
  }

  return ok({ ...distribucion, rechazado: restante });
}
