import { describe, it, expect } from 'vitest';
import { crearFecha, type FechaISO } from '@/shared/domain/fechas';
import type { ReglasDeInteres } from '@/modules/prestamos/domain/intereses';
import {
  libroDelPrestamo,
  libroUnificado,
  type CuotaPactada,
  type LibroDelPrestamo,
  type PagoAlPrestamo,
} from '@/modules/prestamos/domain/libro-del-prestamo';

// Default parameters from docs/reglas-negocio.md, section 10.
const REGLAS: ReglasDeInteres = { tasaEnPuntosBasicos: 200, diaLimiteTasaCompleta: 15, diaDeCorte: 25 };

function fecha(texto: string): FechaISO {
  const r = crearFecha(texto);
  if (!r.ok) throw new Error(`Invalid test date: ${texto}`);
  return r.value;
}

// Agreed plan of 1.000.000 at 2% disbursed on 10 March, 250.000 a month to June.
const PLAN_MAR_JUN: CuotaPactada[] = [
  { numero: 1, mes: fecha('2026-03-01'), capital: 250_000, interes: 20_000 },
  { numero: 2, mes: fecha('2026-04-01'), capital: 250_000, interes: 15_000 },
  { numero: 3, mes: fecha('2026-05-01'), capital: 250_000, interes: 10_000 },
  { numero: 4, mes: fecha('2026-06-01'), capital: 250_000, interes: 5_000 },
];

function pago(mes: string, concepto: PagoAlPrestamo['concepto'], monto: number): PagoAlPrestamo {
  return { mes: fecha(mes), concepto, monto };
}

function libro(params: {
  mesActual: string;
  pagos?: PagoAlPrestamo[];
  plan?: CuotaPactada[];
  desembolso?: string | null;
  monto?: number;
}): LibroDelPrestamo {
  const desembolso = params.desembolso === undefined ? '2026-03-10' : params.desembolso;
  const r = libroDelPrestamo({
    monto: params.monto ?? 1_000_000,
    plan: params.plan ?? PLAN_MAR_JUN,
    pagos: params.pagos ?? [],
    desembolso: desembolso === null ? null : { fecha: fecha(desembolso), reglas: REGLAS },
    mesActual: fecha(params.mesActual),
  });
  if (!r.ok) throw new Error(r.error.mensaje);
  return r.value;
}

describe('libroDelPrestamo: agreed plan (section 4.7, RN-4.3b)', () => {
  it('RN-4.3b: each row shows the agreed capital, interest and installment, informational only', () => {
    const l = libro({ mesActual: '2026-03-15' });
    expect(l.meses.map((m) => [m.numero, m.mes, m.capitalPactado, m.interesPactado, m.cuotaPactada])).toEqual([
      [1, '2026-03-01', 250_000, 20_000, 270_000],
      [2, '2026-04-01', 250_000, 15_000, 265_000],
      [3, '2026-05-01', 250_000, 10_000, 260_000],
      [4, '2026-06-01', 250_000, 5_000, 255_000],
    ]);
    expect(l.resumen.capitalPactado).toBe(1_000_000);
    expect(l.resumen.interesPactado).toBe(50_000);
    expect(l.resumen.cuotasPactadas).toBe(1_050_000);
  });

  it('RN-4.3b: the next installment is the first agreed month whose capital is not fully paid', () => {
    const l = libro({ mesActual: '2026-04-15', pagos: [pago('2026-03-01', 'capital', 250_000)] });
    expect(l.meses.map((m) => m.esLaProximaCuota)).toEqual([false, true, false, false]);
    expect(l.resumen.proximaCuota).toEqual({ mes: '2026-04-01', monto: 265_000 });
  });

  it('RN-4.3b: a partial capital payment keeps that month as the next installment', () => {
    const l = libro({ mesActual: '2026-04-15', pagos: [pago('2026-03-01', 'capital', 100_000)] });
    expect(l.resumen.proximaCuota).toEqual({ mes: '2026-03-01', monto: 270_000 });
  });

  it('RN-4.3b: there is no next installment once every agreed month is paid', () => {
    const l = libro({
      mesActual: '2026-07-15',
      pagos: PLAN_MAR_JUN.map((c) => pago(c.mes, 'capital', c.capital)),
    });
    expect(l.resumen.proximaCuota).toBeNull();
    expect(l.meses.every((m) => !m.esLaProximaCuota)).toBe(true);
  });

  it('RN-4.3b: a payment for a month before the first row counts in the first row and one after the last row in the last row', () => {
    // RN-4.31: the rows go on to August (the current month), so a payment for
    // October counts in the August row.
    const l = libro({
      mesActual: '2026-08-15',
      pagos: [pago('2026-02-01', 'capital', 100_000), pago('2026-10-01', 'intereses', 7_000)],
    });
    expect(l.meses[0].capitalPagado).toBe(100_000);
    expect(l.meses[l.meses.length - 1].mes).toBe('2026-08-01');
    expect(l.meses[l.meses.length - 1].interesPagado).toBe(7_000);
    expect(l.resumen.capitalPagado).toBe(100_000);
    expect(l.resumen.interesesPagados).toBe(7_000);
  });
});

describe('libroDelPrestamo: real view (RN-4.18, RN-4.22, RN-4.22b)', () => {
  it('RN-4.22b: the current month is not in arrears; only finished months are', () => {
    const l = libro({ mesActual: '2026-04-15' });
    expect(l.meses.map((m) => m.interesEnMora)).toEqual([20_000, 0, 0, 0]);
    expect(l.resumen.interesesEnMora).toBe(20_000);
  });

  it('RN-4.22: three months without paying 1.000.000 → 60.000 in arrears', () => {
    const l = libro({ mesActual: '2026-06-15' });
    expect(l.meses.map((m) => m.interesReal)).toEqual([20_000, 20_000, 20_000, 0]);
    expect(l.meses.map((m) => m.interesEnMora)).toEqual([20_000, 20_000, 20_000, 0]);
    expect(l.resumen.interesesEnMora).toBe(60_000);
  });

  it('RN-4.18: interest in arrears is on the real balance, never on the agreed plan', () => {
    // Without capital payments the real balance stays at 1.000.000, so April
    // accrues 20.000 although the agreed plan says 15.000.
    const l = libro({ mesActual: '2026-05-15', pagos: [pago('2026-03-01', 'capital', 250_000), pago('2026-03-01', 'intereses', 20_000)] });
    expect(l.meses[1].interesPactado).toBe(15_000);
    expect(l.meses[1].interesReal).toBe(15_000);
    const sinAbono = libro({ mesActual: '2026-05-15', pagos: [pago('2026-03-01', 'intereses', 20_000)] });
    expect(sinAbono.meses[1].interesReal).toBe(20_000);
    expect(sinAbono.meses[1].interesEnMora).toBe(20_000);
    expect(sinAbono.resumen.interesesEnMora).toBe(20_000);
  });

  it('RN-4.18: capital paid early stops the interest of the later months', () => {
    const l = libro({
      mesActual: '2026-07-15',
      pagos: [pago('2026-03-01', 'capital', 1_000_000), pago('2026-03-01', 'intereses', 20_000)],
    });
    expect(l.meses.map((m) => m.interesEnMora)).toEqual([0, 0, 0, 0]);
    expect(l.meses.map((m) => m.saldoCapitalDespues)).toEqual([0, 0, 0, 0]);
    expect(l.resumen.interesesEnMora).toBe(0);
    expect(l.resumen.saldoCapital).toBe(0);
  });

  it('RN-4.25: a partial interest payment leaves the rest of that month in arrears', () => {
    const l = libro({ mesActual: '2026-04-15', pagos: [pago('2026-03-01', 'intereses', 15_000)] });
    expect(l.meses[0].interesPagado).toBe(15_000);
    expect(l.meses[0].interesEnMora).toBe(5_000);
    expect(l.resumen.interesesEnMora).toBe(5_000);
  });

  it('RN-4.24: the total in arrears is the interest accrued minus every interest payment of the loan', () => {
    // 60.000 accrued (March to May); 30.000 paid for May covers March first.
    const l = libro({ mesActual: '2026-06-15', pagos: [pago('2026-05-01', 'intereses', 30_000)] });
    expect(l.resumen.interesesEnMora).toBe(30_000);
  });

  it('RN-4.3b: interest keeps accruing after the agreed term while the balance is above 0', () => {
    const l = libro({ mesActual: '2026-08-15' });
    // March to July: 5 finished months on 1.000.000.
    expect(l.resumen.interesesEnMora).toBe(100_000);
  });

  it('RN-4.21: a loan disbursed after the cut-off day has no interest in its own month', () => {
    const plan: CuotaPactada[] = [
      { numero: 1, mes: fecha('2026-04-01'), capital: 500_000, interes: 20_000 },
      { numero: 2, mes: fecha('2026-05-01'), capital: 500_000, interes: 10_000 },
    ];
    const l = libro({ mesActual: '2026-05-15', plan, desembolso: '2026-03-28' });
    expect(l.meses.map((m) => m.interesEnMora)).toEqual([20_000, 0]);
    expect(l.resumen.interesesEnMora).toBe(20_000);
  });

  it('RN-4.29: the capital balance after each month is the amount minus the capital paid so far', () => {
    const l = libro({
      mesActual: '2026-05-15',
      pagos: [pago('2026-03-01', 'capital', 250_000), pago('2026-04-01', 'capital', 100_000)],
    });
    expect(l.meses.map((m) => m.saldoCapitalDespues)).toEqual([750_000, 650_000, 650_000, 650_000]);
    expect(l.resumen.saldoCapital).toBe(650_000);
  });

  it('RN-4.29: capital payments above the amount are rejected', () => {
    const r = libroDelPrestamo({
      monto: 1_000_000,
      plan: PLAN_MAR_JUN,
      pagos: [pago('2026-03-01', 'capital', 1_000_001)],
      desembolso: { fecha: fecha('2026-03-10'), reglas: REGLAS },
      mesActual: fecha('2026-04-15'),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.codigo).toBe('abonos_mayores_al_monto');
  });

  it('RN-4.25: interest payments must be whole non-negative pesos', () => {
    const r = libroDelPrestamo({
      monto: 1_000_000,
      plan: PLAN_MAR_JUN,
      pagos: [pago('2026-03-01', 'intereses', -1)],
      desembolso: null,
      mesActual: fecha('2026-04-15'),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.codigo).toBe('intereses_pagados_invalidos');
  });

  it('RN-4.18: a loan not disbursed yet has no interest in arrears', () => {
    const l = libro({ mesActual: '2026-08-15', desembolso: null });
    expect(l.meses.map((m) => m.interesEnMora)).toEqual([0, 0, 0, 0]);
    expect(l.resumen.interesesEnMora).toBe(0);
    expect(l.resumen.saldoCapital).toBe(1_000_000);
  });
});

describe('libroUnificado: every loan of a shareholder month by month', () => {
  const PLAN_MAY_JUN: CuotaPactada[] = [
    { numero: 1, mes: fecha('2026-05-01'), capital: 250_000, interes: 10_000 },
    { numero: 2, mes: fecha('2026-06-01'), capital: 250_000, interes: 5_000 },
  ];

  function dosPrestamos(mesActual: string) {
    const a = libro({ mesActual, pagos: [pago('2026-03-01', 'capital', 250_000), pago('2026-03-01', 'intereses', 20_000)] });
    const b = libro({ mesActual, monto: 500_000, plan: PLAN_MAY_JUN, desembolso: '2026-05-05' });
    return libroUnificado([
      { monto: 1_000_000, fechaDesembolso: fecha('2026-03-10'), libro: a },
      { monto: 500_000, fechaDesembolso: fecha('2026-05-05'), libro: b },
    ]);
  }

  it('adds the rows of every loan over the union of their months', () => {
    // RN-4.31: both loans still have balance in July, so July has a row
    // without agreed values.
    const u = dosPrestamos('2026-07-15');
    expect(u.filas.map((f) => [f.mes, f.capitalPactado, f.interesPactado, f.cuotaPactada])).toEqual([
      ['2026-03-01', 250_000, 20_000, 270_000],
      ['2026-04-01', 250_000, 15_000, 265_000],
      ['2026-05-01', 500_000, 20_000, 520_000],
      ['2026-06-01', 500_000, 10_000, 510_000],
      ['2026-07-01', 0, 0, 0],
    ]);
    expect(u.filas.map((f) => f.capitalPagado)).toEqual([250_000, 0, 0, 0, 0]);
    expect(u.filas.map((f) => f.interesPagado)).toEqual([20_000, 0, 0, 0, 0]);
  });

  it('shows the amount disbursed in its month', () => {
    const u = dosPrestamos('2026-07-15');
    expect(u.filas.map((f) => f.desembolsado)).toEqual([1_000_000, 0, 500_000, 0, 0]);
    expect(u.resumen.desembolsadoEnLasFilas).toBe(1_500_000);
  });

  it('a loan adds nothing before its first month and its last balance after its last month', () => {
    const a = libro({ mesActual: '2026-04-15', plan: PLAN_MAR_JUN.slice(0, 2), pagos: [pago('2026-03-01', 'capital', 250_000)] });
    const b = libro({ mesActual: '2026-04-15', monto: 500_000, plan: PLAN_MAY_JUN, desembolso: '2026-05-05' });
    const u = libroUnificado([
      { monto: 1_000_000, fechaDesembolso: fecha('2026-03-10'), libro: a },
      { monto: 500_000, fechaDesembolso: fecha('2026-05-05'), libro: b },
    ]);
    expect(u.filas.map((f) => [f.mes, f.saldoCapitalDespues])).toEqual([
      ['2026-03-01', 750_000],
      ['2026-04-01', 750_000],
      ['2026-05-01', 1_250_000],
      ['2026-06-01', 1_250_000],
    ]);
  });

  it('RN-4.27: the summary adds up each loan on its own', () => {
    const u = dosPrestamos('2026-07-15');
    // Loan A: 750.000 from April to June (15.000 each) → 45.000.
    // Loan B: 500.000 in May and June (10.000 each) → 20.000.
    expect(u.resumen).toEqual({
      monto: 1_500_000,
      capitalPagado: 250_000,
      interesesPagados: 20_000,
      interesesEnMora: 65_000,
      saldoCapital: 1_250_000,
      capitalPactado: 1_500_000,
      interesPactado: 65_000,
      cuotasPactadas: 1_565_000,
      desembolsadoEnLasFilas: 1_500_000,
    });
    // July is the current month, so it has no interest yet (RN-4.22b).
    expect(u.filas.map((f) => f.interesEnMora)).toEqual([0, 15_000, 25_000, 25_000, 0]);
    expect(u.filas.map((f) => f.interesesPendientesAcumulados)).toEqual([0, 15_000, 40_000, 65_000, 65_000]);
  });

  it('has no rows and zero totals without loans', () => {
    const u = libroUnificado([]);
    expect(u.filas).toEqual([]);
    expect(u.resumen.monto).toBe(0);
    expect(u.resumen.interesesEnMora).toBe(0);
  });
});

describe('libroDelPrestamo: book table (RN-4.31)', () => {
  it('RN-4.31: each row shows the cumulative pending interest; the payment for May leaves 30.000 and June adds 20.000 → 50.000', () => {
    // Owes March, April and May (20.000 each) and pays 30.000 in June, which
    // the receipt stores for May (RN-4.22b, a month in arrears).
    const l = libro({ mesActual: '2026-07-15', pagos: [pago('2026-05-01', 'intereses', 30_000)] });
    expect(l.meses.map((m) => [m.mes, m.interesesPendientesAcumulados])).toEqual([
      ['2026-03-01', 20_000],
      ['2026-04-01', 40_000],
      ['2026-05-01', 30_000],
      ['2026-06-01', 50_000],
      ['2026-07-01', 50_000],
    ]);
    expect(l.resumen.interesesEnMora).toBe(50_000);
  });

  it('RN-4.31: the last row equals the total owed', () => {
    const l = libro({
      mesActual: '2026-06-15',
      pagos: [pago('2026-03-01', 'capital', 250_000), pago('2026-04-01', 'intereses', 25_000)],
    });
    // March 20.000 on 1.000.000; April and May 15.000 on 750.000 → 50.000 − 25.000.
    expect(l.meses.map((m) => m.interesesPendientesAcumulados)).toEqual([20_000, 10_000, 25_000, 25_000]);
    expect(l.meses[l.meses.length - 1].interesesPendientesAcumulados).toBe(l.resumen.interesesEnMora);
  });

  it('RN-4.31: when the agreed term ends with balance left, the table keeps adding rows on the real balance', () => {
    const l = libro({ mesActual: '2026-09-15', pagos: [pago('2026-03-01', 'capital', 500_000)] });
    expect(l.meses.map((m) => [m.numero, m.mes, m.capitalPactado, m.cuotaPactada, m.saldoCapitalDespues])).toEqual([
      [1, '2026-03-01', 250_000, 270_000, 500_000],
      [2, '2026-04-01', 250_000, 265_000, 500_000],
      [3, '2026-05-01', 250_000, 260_000, 500_000],
      [4, '2026-06-01', 250_000, 255_000, 500_000],
      [5, '2026-07-01', 0, 0, 500_000],
      [6, '2026-08-01', 0, 0, 500_000],
      [7, '2026-09-01', 0, 0, 500_000],
    ]);
    // March 20.000 on 1.000.000, then April to August 10.000 each on 500.000.
    expect(l.meses.map((m) => m.interesReal)).toEqual([20_000, 10_000, 10_000, 10_000, 10_000, 10_000, 0]);
    expect(l.meses.map((m) => m.interesesPendientesAcumulados)).toEqual([
      20_000, 30_000, 40_000, 50_000, 60_000, 70_000, 70_000,
    ]);
    expect(l.resumen.interesesEnMora).toBe(70_000);
  });

  it('RN-4.31: a payment for a month after the agreed term lands in its own row', () => {
    const l = libro({ mesActual: '2026-08-15', pagos: [pago('2026-07-01', 'intereses', 7_000)] });
    expect(l.meses[4].mes).toBe('2026-07-01');
    expect(l.meses[4].interesPagado).toBe(7_000);
  });

  it('RN-4.31: a loan not disbursed yet adds no rows after the agreed term', () => {
    const l = libro({ mesActual: '2026-09-15', desembolso: null });
    expect(l.meses).toHaveLength(4);
  });

  it('RN-4.31, RN-4.28: a paid loan shows no next installment', () => {
    // Capital paid in full in March with its interest: capital and interest are 0.
    const l = libro({
      mesActual: '2026-05-15',
      pagos: [pago('2026-03-01', 'capital', 1_000_000), pago('2026-03-01', 'intereses', 20_000)],
    });
    expect(l.resumen.saldoCapital).toBe(0);
    expect(l.resumen.interesesEnMora).toBe(0);
    expect(l.resumen.proximaCuota).toBeNull();
    expect(l.meses.every((m) => !m.esLaProximaCuota)).toBe(true);
    expect(l.meses).toHaveLength(4);
  });

  it('RN-4.28: a loan with capital 0 but interest still owed keeps its next installment', () => {
    const l = libro({ mesActual: '2026-05-15', pagos: [pago('2026-03-01', 'capital', 1_000_000)] });
    expect(l.resumen.interesesEnMora).toBe(20_000);
    expect(l.resumen.proximaCuota).not.toBeNull();
  });

  it('RN-4.31: the unified book adds the cumulative pending interest of every loan month by month', () => {
    const a = libro({ mesActual: '2026-06-15', plan: PLAN_MAR_JUN.slice(0, 2), pagos: [pago('2026-04-01', 'intereses', 30_000)] });
    const b = libro({
      mesActual: '2026-06-15',
      monto: 500_000,
      plan: [{ numero: 1, mes: fecha('2026-04-01'), capital: 500_000, interes: 10_000 }],
      desembolso: '2026-04-05',
    });
    const u = libroUnificado([
      { monto: 1_000_000, fechaDesembolso: fecha('2026-03-10'), libro: a },
      { monto: 500_000, fechaDesembolso: fecha('2026-04-05'), libro: b },
    ]);
    // A: 20.000, 40.000 − 30.000 = 10.000, 30.000, 30.000 (June not finished).
    // B: 10.000, 20.000, 20.000.
    expect(u.filas.map((f) => [f.mes, f.interesesPendientesAcumulados])).toEqual([
      ['2026-03-01', 20_000],
      ['2026-04-01', 20_000],
      ['2026-05-01', 50_000],
      ['2026-06-01', 50_000],
    ]);
    expect(u.filas[u.filas.length - 1].interesesPendientesAcumulados).toBe(u.resumen.interesesEnMora);
  });
});
