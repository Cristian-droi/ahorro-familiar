import { describe, it, expect } from 'vitest';
import { crearFecha, type FechaISO } from '@/shared/domain/fechas';
import type { ReglasDeInteres } from '@/modules/prestamos/domain/intereses';
import {
  interesesAdeudados,
  type AbonoACapital,
  type InteresesAdeudados, saldoDeCapital } from '@/modules/prestamos/domain/intereses-adeudados';

// Default parameters from docs/reglas-negocio.md, section 10.
const REGLAS: ReglasDeInteres = { tasaEnPuntosBasicos: 200, diaLimiteTasaCompleta: 15, diaDeCorte: 25 };

function fecha(texto: string): FechaISO {
  const r = crearFecha(texto);
  if (!r.ok) throw new Error(`Invalid test date: ${texto}`);
  return r.value;
}

function calcular(params: {
  desembolso: string;
  hoy: string;
  monto?: number;
  abonos?: { mes: string; monto: number }[];
  pagados?: number;
}): InteresesAdeudados {
  const r = interesesAdeudados({
    fechaDesembolso: fecha(params.desembolso),
    hoy: fecha(params.hoy),
    monto: params.monto ?? 1_000_000,
    abonosACapital: (params.abonos ?? []).map((a): AbonoACapital => ({ mes: fecha(a.mes), monto: a.monto })),
    pagosDeIntereses: params.pagados ? [{ monto: params.pagados }] : [],
    reglas: REGLAS,
  });
  if (!r.ok) throw new Error(r.error.mensaje);
  return r.value;
}

describe('interesesAdeudados (RN-4.18 to RN-4.22, RN-4.25, RN-4.3b)', () => {
  it('RN-4.18 rule example: disbursed on 10 March, March interest on 1.000.000 is 20.000', () => {
    const r = calcular({ desembolso: '2026-03-10', hoy: '2026-04-05' });
    expect(r.porMes).toEqual([{ mes: '2026-03-01', saldoCapital: 1_000_000, interes: 20_000 }]);
    expect(r.adeudado).toBe(20_000);
  });

  it('RN-4.20 rule example: disbursed on 20 March, March interest is 10.000 (half rate)', () => {
    expect(calcular({ desembolso: '2026-03-20', hoy: '2026-04-05' }).adeudado).toBe(10_000);
  });

  it('RN-4.21 rule example: disbursed on 28 March, March owes 0 and April 20.000', () => {
    const r = calcular({ desembolso: '2026-03-28', hoy: '2026-05-02' });
    expect(r.porMes.map((m) => m.interes)).toEqual([0, 20_000]);
    expect(r.adeudado).toBe(20_000);
  });

  it('RN-4.22 rule example: three months unpaid on 1.000.000 owe 60.000', () => {
    expect(calcular({ desembolso: '2026-01-10', hoy: '2026-04-10' }).adeudado).toBe(60_000);
  });

  it('only finished months accrue: the current month is not owed yet', () => {
    expect(calcular({ desembolso: '2026-03-10', hoy: '2026-03-31' }).adeudado).toBe(0);
    expect(calcular({ desembolso: '2026-03-10', hoy: '2026-03-31' }).porMes).toEqual([]);
  });

  it('owes nothing when today is before the disbursement month', () => {
    expect(calcular({ desembolso: '2026-03-10', hoy: '2026-02-20' }).adeudado).toBe(0);
  });

  it('RN-4.18: each month uses the real balance after the capital paid in earlier months, never the plan', () => {
    const r = calcular({
      desembolso: '2026-01-10',
      hoy: '2026-04-10',
      abonos: [{ mes: '2026-01-01', monto: 500_000 }],
    });
    // January on 1.000.000; the January payment lowers February and March.
    expect(r.porMes.map((m) => m.saldoCapital)).toEqual([1_000_000, 500_000, 500_000]);
    expect(r.porMes.map((m) => m.interes)).toEqual([20_000, 10_000, 10_000]);
    expect(r.causados).toBe(40_000);
  });

  it('RN-4.18: capital paid for a later month does not lower the balance of earlier months', () => {
    const r = calcular({
      desembolso: '2026-01-10',
      hoy: '2026-03-10',
      abonos: [{ mes: '2026-05-01', monto: 400_000 }],
    });
    expect(r.porMes.map((m) => m.saldoCapital)).toEqual([1_000_000, 1_000_000]);
  });

  it('RN-4.19: unpaid interest never earns interest (simple interest)', () => {
    const r = calcular({ desembolso: '2026-01-10', hoy: '2026-07-01' });
    expect(r.porMes.every((m) => m.interes === 20_000)).toBe(true);
    expect(r.causados).toBe(120_000);
  });

  it('RN-4.3b: interest runs past December until the capital balance is 0, and stops there', () => {
    const r = calcular({
      desembolso: '2026-11-05',
      hoy: '2027-04-01',
      abonos: [{ mes: '2027-01-01', monto: 1_000_000 }],
    });
    // November, December and January on 1.000.000; nothing after the balance is 0.
    expect(r.porMes.map((m) => m.mes)).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
    expect(r.causados).toBe(60_000);
  });

  it('RN-4.25 rule example: owes 60.000, paid 40.000, 20.000 of interest remain', () => {
    const r = calcular({ desembolso: '2026-01-10', hoy: '2026-04-10', pagados: 40_000 });
    expect(r).toMatchObject({ causados: 60_000, pagados: 40_000, adeudado: 20_000 });
  });

  it('interest paid beyond what accrued leaves nothing owed, never a negative debt', () => {
    expect(calcular({ desembolso: '2026-03-10', hoy: '2026-04-05', pagados: 30_000 }).adeudado).toBe(0);
  });

  it('a capital payment dated in any day of a month counts for that month', () => {
    const r = calcular({
      desembolso: '2026-01-10',
      hoy: '2026-03-10',
      abonos: [{ mes: '2026-01-20', monto: 500_000 }],
    });
    expect(r.porMes.map((m) => m.saldoCapital)).toEqual([1_000_000, 500_000]);
  });

  it('RN-4.29: rejects capital payments that add up to more than the loan', () => {
    const r = interesesAdeudados({
      fechaDesembolso: fecha('2026-01-10'),
      hoy: fecha('2026-04-10'),
      monto: 1_000_000,
      abonosACapital: [
        { mes: fecha('2026-01-01'), monto: 600_000 },
        { mes: fecha('2026-02-01'), monto: 600_000 },
      ],
      pagosDeIntereses: [],
      reglas: REGLAS,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.codigo).toBe('abonos_mayores_al_monto');
  });

  it('RN-4.25: adds up every interest payment before subtracting it', () => {
    const r = interesesAdeudados({
      fechaDesembolso: fecha('2026-03-10'),
      hoy: fecha('2026-07-15'),
      monto: 1_000_000,
      abonosACapital: [],
      pagosDeIntereses: [{ monto: 20_000 }, { monto: 30_000 }],
      reglas: REGLAS,
    });
    expect(r.ok && r.value).toMatchObject({ causados: 80_000, pagados: 50_000, adeudado: 30_000 });
  });

  it.each([
    ['monto', { monto: 0 }, 'monto_invalido'],
    ['monto', { monto: 1.5 }, 'monto_invalido'],
    ['abono', { abonosACapital: [{ mes: '2026-01-01' as FechaISO, monto: -1 }] }, 'abono_invalido'],
    ['pago de intereses', { pagosDeIntereses: [{ monto: -5 }] }, 'intereses_pagados_invalidos'],
  ])('rejects an invalid %s', (_campo, cambio, codigo) => {
    const r = interesesAdeudados({
      fechaDesembolso: fecha('2026-01-10'),
      hoy: fecha('2026-04-10'),
      monto: 1_000_000,
      abonosACapital: [],
      pagosDeIntereses: [],
      reglas: REGLAS,
      ...cambio,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.codigo).toBe(codigo);
  });
});

describe('saldoDeCapital (RN-4.29)', () => {
  it('RN-4.29: the balance is the amount minus every capital payment', () => {
    const r = saldoDeCapital({
      monto: 1_000_000,
      abonosACapital: [
        { mes: fecha('2026-04-01'), monto: 300_000 },
        { mes: fecha('2026-05-01'), monto: 200_000 },
      ],
    });
    expect(r).toEqual({ ok: true, value: 500_000 });
  });

  it('RN-4.29: rejects capital payments above the amount instead of returning a negative balance', () => {
    const r = saldoDeCapital({ monto: 100, abonosACapital: [{ mes: fecha('2026-04-01'), monto: 101 }] });
    expect(!r.ok && r.error.codigo).toBe('abonos_mayores_al_monto');
  });

  it('RN-4.29: rejects a negative payment', () => {
    const r = saldoDeCapital({ monto: 100, abonosACapital: [{ mes: fecha('2026-04-01'), monto: -1 }] });
    expect(!r.ok && r.error.codigo).toBe('abono_invalido');
  });
});
