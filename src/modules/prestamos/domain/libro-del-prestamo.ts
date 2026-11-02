// Loan book: the agreed plan next to the real payments, month by month
// (docs/reglas-negocio.md, section 4.7, RN-4.3b, RN-4.18, RN-4.22, RN-4.22b,
// RN-4.24, RN-4.25 and RN-4.29).
//
// - Agreed view (RN-4.3b, informational): capital, interest and installment of
//   each agreed month, and the next installment to suggest.
// - Real view (RN-4.18): interest on the real balance from `interesesAdeudados`,
//   the single source of interest owed (section 11, n.º 13).
//
// Payments are matched to rows by calendar month. A payment for a month before
// the first row counts in the first row and one after the last row in the last
// row, so no payment is lost from the table.

import { mesesEntre, primerDiaDelMes, type FechaISO } from '@/shared/domain/fechas';
import { ok, err, type Result, type ErrorDeDominio } from '@/shared/domain/result';
import type { ReglasDeInteres } from '@/modules/prestamos/domain/intereses';
import { interesesAdeudados, saldoDeCapital, type AbonoACapital } from '@/modules/prestamos/domain/intereses-adeudados';

// One month of the agreed plan (RN-4.3b).
export interface CuotaPactada {
  numero: number;
  mes: FechaISO;
  capital: number;
  interes: number;
}

// An approved payment item of the loan and the month it targets.
export interface PagoAlPrestamo {
  mes: FechaISO;
  concepto: 'capital' | 'intereses';
  monto: number;
}

export interface MesDelLibro {
  numero: number;
  mes: FechaISO;
  capitalPactado: number;
  interesPactado: number;
  cuotaPactada: number;
  capitalPagado: number;
  interesPagado: number;
  // RN-4.18: interest of this month on the real opening balance; 0 until the
  // month ends (RN-4.22b) or once the balance is 0 (RN-4.3b).
  interesReal: number;
  // Real interest of the month not covered by the interest paid for it.
  interesEnMora: number;
  // Real capital balance at the end of the month.
  saldoCapitalDespues: number;
  esLaProximaCuota: boolean;
}

export interface ResumenDelLibro {
  monto: number;
  capitalPagado: number;
  interesesPagados: number;
  // RN-4.24: interest accrued minus every interest payment of the loan.
  interesesEnMora: number;
  saldoCapital: number;
  capitalPactado: number;
  interesPactado: number;
  cuotasPactadas: number;
  proximaCuota: { mes: FechaISO; monto: number } | null;
}

export interface LibroDelPrestamo {
  meses: MesDelLibro[];
  resumen: ResumenDelLibro;
}

const sumar = (valores: number[]) => valores.reduce((suma, v) => suma + v, 0);

export function libroDelPrestamo(params: {
  monto: number;
  plan: CuotaPactada[];
  pagos: PagoAlPrestamo[];
  // Null while the loan has not been disbursed: there is no interest yet.
  desembolso: { fecha: FechaISO; reglas: ReglasDeInteres } | null;
  mesActual: FechaISO;
}): Result<LibroDelPrestamo, ErrorDeDominio> {
  const { monto, plan, pagos, desembolso, mesActual } = params;

  const abonosACapital: AbonoACapital[] = pagos
    .filter((p) => p.concepto === 'capital')
    .map((p) => ({ mes: p.mes, monto: p.monto }));
  const pagosDeIntereses = pagos.filter((p) => p.concepto === 'intereses').map((p) => ({ monto: p.monto }));

  // RN-4.29: payments are valid and never exceed the amount.
  const saldo = saldoDeCapital({ monto, abonosACapital });
  if (!saldo.ok) return saldo;

  let interesPorMes = new Map<FechaISO, number>();
  let interesesEnMora = 0;
  if (desembolso) {
    const adeudado = interesesAdeudados({
      fechaDesembolso: desembolso.fecha,
      hoy: mesActual,
      monto,
      abonosACapital,
      pagosDeIntereses,
      reglas: desembolso.reglas,
    });
    if (!adeudado.ok) return adeudado;
    interesPorMes = new Map(adeudado.value.porMes.map((m) => [m.mes, m.interes]));
    interesesEnMora = adeudado.value.adeudado;
  } else if (pagosDeIntereses.some((p) => !Number.isInteger(p.monto) || p.monto < 0)) {
    // Same check `interesesAdeudados` does for a disbursed loan (RN-4.25).
    return err({
      codigo: 'intereses_pagados_invalidos',
      mensaje: 'Los intereses pagados deben ser un número entero no negativo.',
    });
  }

  // Row of each payment: its own month, kept inside the plan range.
  const meses = plan.map((c) => primerDiaDelMes(c.mes));
  const filaDelPago = (mes: FechaISO): number => {
    const objetivo = primerDiaDelMes(mes);
    if (meses.length === 0) return -1;
    if (mesesEntre(meses[0], objetivo) < 0) return 0;
    if (mesesEntre(meses[meses.length - 1], objetivo) > 0) return meses.length - 1;
    return meses.findIndex((m) => m === objetivo);
  };
  const capitalPorFila = plan.map(() => 0);
  const interesPorFila = plan.map(() => 0);
  for (const p of pagos) {
    const fila = filaDelPago(p.mes);
    if (fila < 0) continue;
    if (p.concepto === 'capital') capitalPorFila[fila] += p.monto;
    else interesPorFila[fila] += p.monto;
  }

  let saldoCorriente = monto;
  let proximaCuota: ResumenDelLibro['proximaCuota'] = null;
  const filas: MesDelLibro[] = plan.map((c, i) => {
    const mes = meses[i];
    const terminado = mesesEntre(mes, primerDiaDelMes(mesActual)) > 0;
    const interesReal = terminado ? (interesPorMes.get(mes) ?? 0) : 0;
    saldoCorriente -= capitalPorFila[i];
    const esLaProximaCuota = proximaCuota === null && c.capital > 0 && capitalPorFila[i] < c.capital;
    if (esLaProximaCuota) proximaCuota = { mes: c.mes, monto: c.capital + c.interes };
    return {
      numero: c.numero,
      mes: c.mes,
      capitalPactado: c.capital,
      interesPactado: c.interes,
      cuotaPactada: c.capital + c.interes,
      capitalPagado: capitalPorFila[i],
      interesPagado: interesPorFila[i],
      interesReal,
      interesEnMora: Math.max(interesReal - interesPorFila[i], 0),
      saldoCapitalDespues: saldoCorriente,
      esLaProximaCuota,
    };
  });

  return ok({
    meses: filas,
    resumen: {
      monto,
      capitalPagado: sumar(abonosACapital.map((a) => a.monto)),
      interesesPagados: sumar(pagosDeIntereses.map((p) => p.monto)),
      interesesEnMora,
      saldoCapital: saldo.value,
      capitalPactado: sumar(plan.map((c) => c.capital)),
      interesPactado: sumar(plan.map((c) => c.interes)),
      cuotasPactadas: sumar(filas.map((f) => f.cuotaPactada)),
      proximaCuota,
    },
  });
}

// ============================================================
// Unified book: every loan of a shareholder in one table, month by month.
// ============================================================

export interface FilaDelLibroUnificado {
  mes: FechaISO;
  // Amount of the loans disbursed in this calendar month.
  desembolsado: number;
  capitalPactado: number;
  interesPactado: number;
  cuotaPactada: number;
  capitalPagado: number;
  interesPagado: number;
  interesEnMora: number;
  // Sum of the balances: a loan adds nothing before its first month and its
  // last balance after its last month.
  saldoCapitalDespues: number;
}

export interface ResumenDelLibroUnificado {
  monto: number;
  capitalPagado: number;
  interesesPagados: number;
  interesesEnMora: number;
  saldoCapital: number;
  capitalPactado: number;
  interesPactado: number;
  cuotasPactadas: number;
  // Amount disbursed in the months that have a row.
  desembolsadoEnLasFilas: number;
}

export interface LibroUnificado {
  filas: FilaDelLibroUnificado[];
  resumen: ResumenDelLibroUnificado;
}

export function libroUnificado(
  prestamos: { monto: number; fechaDesembolso: FechaISO | null; libro: LibroDelPrestamo }[],
): LibroUnificado {
  const meses = Array.from(
    new Set(prestamos.flatMap((p) => p.libro.meses.map((m) => primerDiaDelMes(m.mes)))),
  ).sort();

  const filas: FilaDelLibroUnificado[] = meses.map((mes) => {
    const fila: FilaDelLibroUnificado = {
      mes,
      desembolsado: 0,
      capitalPactado: 0,
      interesPactado: 0,
      cuotaPactada: 0,
      capitalPagado: 0,
      interesPagado: 0,
      interesEnMora: 0,
      saldoCapitalDespues: 0,
    };
    for (const p of prestamos) {
      if (p.fechaDesembolso && primerDiaDelMes(p.fechaDesembolso) === mes) fila.desembolsado += p.monto;
      const delMes = p.libro.meses.find((m) => primerDiaDelMes(m.mes) === mes);
      if (delMes) {
        fila.capitalPactado += delMes.capitalPactado;
        fila.interesPactado += delMes.interesPactado;
        fila.cuotaPactada += delMes.cuotaPactada;
        fila.capitalPagado += delMes.capitalPagado;
        fila.interesPagado += delMes.interesPagado;
        fila.interesEnMora += delMes.interesEnMora;
        fila.saldoCapitalDespues += delMes.saldoCapitalDespues;
        continue;
      }
      const primero = p.libro.meses[0];
      const ultimo = p.libro.meses[p.libro.meses.length - 1];
      if (!primero || mesesEntre(primerDiaDelMes(primero.mes), mes) < 0) continue;
      fila.saldoCapitalDespues += ultimo.saldoCapitalDespues;
    }
    return fila;
  });

  const resumenes = prestamos.map((p) => p.libro.resumen);
  return {
    filas,
    resumen: {
      monto: sumar(resumenes.map((r) => r.monto)),
      capitalPagado: sumar(resumenes.map((r) => r.capitalPagado)),
      interesesPagados: sumar(resumenes.map((r) => r.interesesPagados)),
      interesesEnMora: sumar(resumenes.map((r) => r.interesesEnMora)),
      saldoCapital: sumar(resumenes.map((r) => r.saldoCapital)),
      capitalPactado: sumar(resumenes.map((r) => r.capitalPactado)),
      interesPactado: sumar(resumenes.map((r) => r.interesPactado)),
      cuotasPactadas: sumar(resumenes.map((r) => r.cuotasPactadas)),
      desembolsadoEnLasFilas: sumar(filas.map((f) => f.desembolsado)),
    },
  };
}
