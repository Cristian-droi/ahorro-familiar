// Agreed payment plan of a loan (docs/reglas-negocio.md, section 4.7 "Plan pactado").
// Term from RN-4.3 and RN-4.15, interest per month from RN-4.18 to RN-4.21,
// free capital per installment from RN-4.26. Whole pesos throughout.

import { sumarMeses, type FechaISO } from '@/shared/domain/fechas';
import { ok, err, type Result, type ErrorDeDominio } from '@/shared/domain/result';
import { mesAplicado, plazoDelPrestamo } from '@/modules/prestamos/domain/calendario';
import { interesDelMes, type ReglasDeInteres } from '@/modules/prestamos/domain/intereses';

export interface CuotaDelPlan {
  // 1 for the applied month (RN-4.15), up to the last month of the term.
  numero: number;
  // First day of the installment's month.
  mes: FechaISO;
  capital: number;
  interes: number;
  saldoDespues: number;
}

// Capital of each installment. Without edits the amount is split in equal
// whole-peso parts and the last installment absorbs the remainder. With edits
// (RN-4.26: the capital payment is free):
//   a) an edited installment keeps its value;
//   b) unedited installments before the last edited one keep the equal part,
//      unless that exceeds the amount, in which case they drop to zero;
//   c) unedited installments after the last edited one share what is left in
//      equal parts, the last of them absorbing the remainder; when there are
//      none, the last installment absorbs the difference.
function capitalDeCadaCuota(monto: number, meses: number, editadas: Record<number, number>): number[] {
  const parteIgual = Math.floor(monto / meses);
  const claves = Object.keys(editadas).map(Number).sort((a, b) => a - b);
  const capitales: number[] = new Array(meses).fill(0);

  if (claves.length === 0) {
    for (let i = 0; i < meses; i++) {
      capitales[i] = i === meses - 1 ? monto - parteIgual * (meses - 1) : parteIgual;
    }
    return capitales;
  }

  const ultimaEditada = claves[claves.length - 1];
  for (let n = 1; n <= meses; n++) {
    if (editadas[n] !== undefined) capitales[n - 1] = editadas[n];
    else if (n < ultimaEditada) capitales[n - 1] = parteIgual;
  }

  const suma = () => capitales.reduce((s, v) => s + v, 0);
  let restante = monto - suma();
  if (restante < 0) {
    for (let n = 1; n < ultimaEditada && n <= meses; n++) {
      if (editadas[n] === undefined) capitales[n - 1] = 0;
    }
    restante = Math.max(0, monto - suma());
  }

  const posteriores: number[] = [];
  for (let n = ultimaEditada + 1; n <= meses; n++) {
    if (editadas[n] === undefined) posteriores.push(n);
  }

  if (posteriores.length > 0) {
    const parte = Math.floor(restante / posteriores.length);
    posteriores.forEach((n, i) => {
      capitales[n - 1] = i === posteriores.length - 1 ? restante - parte * (posteriores.length - 1) : parte;
    });
  } else if (restante !== 0) {
    capitales[meses - 1] += restante;
  }
  return capitales;
}

export function planDePagos(params: {
  monto: number;
  fechaDesembolso: FechaISO;
  reglas: ReglasDeInteres;
  // RN-4.3: the admin can allow (⚙️) terms until December of the next period.
  hastaPeriodoSiguiente: boolean;
  // Edited capital by installment number (1 = applied month).
  capitalPorCuota?: Record<number, number>;
}): Result<CuotaDelPlan[], ErrorDeDominio> {
  const { monto, fechaDesembolso, reglas, hastaPeriodoSiguiente, capitalPorCuota = {} } = params;
  if (!Number.isInteger(monto) || monto <= 0) {
    return err({ codigo: 'monto_invalido', mensaje: 'El monto del préstamo debe ser un número entero positivo.' });
  }
  for (const valor of Object.values(capitalPorCuota)) {
    if (!Number.isInteger(valor) || valor < 0) {
      return err({
        codigo: 'capital_invalido',
        mensaje: 'El capital de cada cuota debe ser un número entero no negativo.',
      });
    }
  }

  const inicio = mesAplicado(fechaDesembolso, reglas.diaDeCorte);
  const { meses } = plazoDelPrestamo({ mesAplicado: inicio, hastaPeriodoSiguiente });
  const capitales = capitalDeCadaCuota(monto, meses, capitalPorCuota);

  const cuotas: CuotaDelPlan[] = [];
  let saldo = monto;
  for (let i = 0; i < meses; i++) {
    const mes = sumarMeses(inicio, i);
    // RN-4.18: interest on the outstanding balance at the start of the month.
    const interes = interesDelMes({ saldoCapital: saldo, mes, fechaDesembolso, reglas });
    if (!interes.ok) return interes;
    const capital = Math.min(capitales[i], saldo);
    saldo -= capital;
    cuotas.push({ numero: i + 1, mes, capital, interes: interes.value, saldoDespues: saldo });
  }
  return ok(cuotas);
}
