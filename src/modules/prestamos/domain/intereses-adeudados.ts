// Interest owed by one loan as of a given day (docs/reglas-negocio.md,
// RN-4.18 to RN-4.22, RN-4.25 and RN-4.3b). This is the single source for the
// loan summary and the obligations check (section 11, n.º 13): the per-month
// interest comes from `interesesDelPeriodo`.

import { mesSiguiente, mesesEntre, primerDiaDelMes, type FechaISO } from '@/shared/domain/fechas';
import { ok, err, type Result, type ErrorDeDominio } from '@/shared/domain/result';
import { interesesDelPeriodo, type ReglasDeInteres } from '@/modules/prestamos/domain/intereses';

// A capital payment and the month it was applied to (any day of the month).
export interface AbonoACapital {
  mes: FechaISO;
  monto: number;
}

export interface InteresesAdeudados {
  // Finished months from the disbursement month while the capital is above 0,
  // with the opening real balance of each month.
  porMes: { mes: FechaISO; saldoCapital: number; interes: number }[];
  // Interest accrued in those months (RN-4.22).
  causados: number;
  // Interest already paid (RN-4.25).
  pagados: number;
  // What is still owed; never negative.
  adeudado: number;
}

const esEnteroNoNegativo = (n: number) => Number.isInteger(n) && n >= 0;

export function interesesAdeudados(params: {
  fechaDesembolso: FechaISO;
  hoy: FechaISO;
  // Disbursed capital.
  monto: number;
  abonosACapital: AbonoACapital[];
  // RN-4.25: each approved interest payment; the domain adds them up.
  pagosDeIntereses: { monto: number }[];
  reglas: ReglasDeInteres;
}): Result<InteresesAdeudados, ErrorDeDominio> {
  const { fechaDesembolso, hoy, monto, abonosACapital, pagosDeIntereses, reglas } = params;

  if (!Number.isInteger(monto) || monto <= 0) {
    return err({ codigo: 'monto_invalido', mensaje: 'El monto del préstamo debe ser un número entero mayor que cero.' });
  }
  if (pagosDeIntereses.some((p) => !esEnteroNoNegativo(p.monto))) {
    return err({
      codigo: 'intereses_pagados_invalidos',
      mensaje: 'Los intereses pagados deben ser un número entero no negativo.',
    });
  }
  const interesesPagados = pagosDeIntereses.reduce((suma, p) => suma + p.monto, 0);

  // RN-4.29: the capital payments are valid and never exceed the amount.
  const validacion = saldoDeCapital({ monto, abonosACapital });
  if (!validacion.ok) return validacion;
  const abonosPorMes = new Map<FechaISO, number>();
  for (const abono of abonosACapital) {
    const mes = primerDiaDelMes(abono.mes);
    abonosPorMes.set(mes, (abonosPorMes.get(mes) ?? 0) + abono.monto);
  }

  // RN-4.18: each month accrues on the real balance at its start, that is the
  // amount minus the capital paid for earlier months. Only finished months are
  // owed. RN-4.3b: it stops once the capital balance is 0.
  const meses: { mes: FechaISO; saldoCapital: number }[] = [];
  const mesActual = primerDiaDelMes(hoy);
  let saldo = monto;
  for (let mes = primerDiaDelMes(fechaDesembolso); mesesEntre(mes, mesActual) > 0 && saldo > 0; mes = mesSiguiente(mes)) {
    meses.push({ mes, saldoCapital: saldo });
    saldo -= abonosPorMes.get(mes) ?? 0;
  }

  // RN-4.19 to RN-4.22 (simple interest, first month, cut-off day) live in
  // `interesDelMes`.
  const periodo = interesesDelPeriodo({ fechaDesembolso, meses, reglas });
  if (!periodo.ok) return periodo;

  const causados = periodo.value.total;
  return ok({
    porMes: meses.map((m, i) => ({ ...m, interes: periodo.value.porMes[i].interes })),
    causados,
    pagados: interesesPagados,
    adeudado: Math.max(causados - interesesPagados, 0),
  });
}

// RN-4.29: the capital balance of a loan is its amount minus every capital
// payment; it never goes negative, so payments above the amount are rejected.
export function saldoDeCapital(params: {
  monto: number;
  abonosACapital: AbonoACapital[];
}): Result<number, ErrorDeDominio> {
  let total = 0;
  for (const abono of params.abonosACapital) {
    if (!esEnteroNoNegativo(abono.monto)) {
      return err({ codigo: 'abono_invalido', mensaje: 'Cada abono a capital debe ser un número entero no negativo.' });
    }
    total += abono.monto;
  }
  if (total > params.monto) {
    return err({
      codigo: 'abonos_mayores_al_monto',
      mensaje: 'Los abonos a capital suman más que el monto del préstamo.',
    });
  }
  return ok(params.monto - total);
}
