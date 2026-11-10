import { describe, it, expect } from 'vitest';
import { interesesPorMesDelAnio, resumenDelPeriodo, utilidadDelMes, utilidadesDelAnio } from '@/modules/utilidades/domain/utilidades';
import type { FechaISO } from '@/shared/domain/fechas';

const f = (texto: string) => texto as FechaISO;

describe('utilidadDelMes (RN-6.2, RN-6.3)', () => {
  it('RN-6.3: 100.000 of interest paid in April and Ana holds 30%: 30.000', () => {
    expect(utilidadDelMes({ aporteDelAccionista: 300_000, aporteDelGrupo: 1_000_000, interesesPagados: 100_000 })).toBe(30_000);
  });

  it('rounds to the peso, as today', () => {
    // 1/3 of 100.000 = 33.333,33
    expect(utilidadDelMes({ aporteDelAccionista: 1, aporteDelGrupo: 3, interesesPagados: 100_000 })).toBe(33_333);
    // 2/3 of 100.000 = 66.666,67
    expect(utilidadDelMes({ aporteDelAccionista: 2, aporteDelGrupo: 3, interesesPagados: 100_000 })).toBe(66_667);
  });

  it('a group with no contributions shares nothing', () => {
    expect(utilidadDelMes({ aporteDelAccionista: 0, aporteDelGrupo: 0, interesesPagados: 100_000 })).toBe(0);
  });

  it('keeps exact pesos for large amounts', () => {
    // 4.000.000.000 × 900.000.000 overflows plain doubles before dividing.
    expect(
      utilidadDelMes({ aporteDelAccionista: 4_000_000_000, aporteDelGrupo: 9_000_000_000, interesesPagados: 900_000_000 }),
    ).toBe(400_000_000);
  });
});

describe('utilidadesDelAnio (RN-6.1 to RN-6.4)', () => {
  const aportes = [
    { accionistaId: 'ana', mes: f('2026-04-01'), monto: 300_000 },
    { accionistaId: 'luis', mes: f('2026-04-01'), monto: 700_000 },
  ];

  it('RN-6.2: participation counts what each one contributed up to that month, inclusive', () => {
    const r = utilidadesDelAnio({
      anio: 2026,
      accionistas: ['ana', 'luis'],
      aportes: [...aportes, { accionistaId: 'ana', mes: f('2026-05-01'), monto: 1_000_000 }],
      interesesPagados: [
        { mes: f('2026-04-01'), monto: 100_000 },
        { mes: f('2026-05-01'), monto: 100_000 },
      ],
    });
    expect(r.get('ana')?.[3]).toEqual({ mes: '2026-04-01', interesesDelMes: 100_000, participacion: 0.3, utilidad: 30_000 });
    // May: Ana 1.300.000 of 2.000.000 = 65%
    expect(r.get('ana')?.[4]).toEqual({ mes: '2026-05-01', interesesDelMes: 100_000, participacion: 0.65, utilidad: 65_000 });
    expect(r.get('luis')?.[4].utilidad).toBe(35_000);
  });

  it('RN-6.1 (Cris, 2026-11-10): interest is shared in the month it belongs to, with that month participation', () => {
    // The June payment for May's interest is stored with May as its month.
    const r = utilidadesDelAnio({
      anio: 2026,
      accionistas: ['ana', 'luis'],
      aportes: [...aportes, { accionistaId: 'ana', mes: f('2026-06-01'), monto: 1_000_000 }],
      interesesPagados: [{ mes: f('2026-05-01'), monto: 100_000 }],
    });
    expect(r.get('ana')?.[4].utilidad).toBe(30_000);
    expect(r.get('ana')?.[5].utilidad).toBe(0);
  });

  it('returns the twelve months, with zero before anyone contributed', () => {
    const r = utilidadesDelAnio({ anio: 2026, accionistas: ['ana'], aportes: [], interesesPagados: [] });
    expect(r.get('ana')).toHaveLength(12);
    expect(r.get('ana')?.every((m) => m.utilidad === 0)).toBe(true);
    expect(r.get('ana')?.[0].mes).toBe('2026-01-01');
  });

  it('a shareholder who contributed nothing still gets the twelve months at zero', () => {
    const r = utilidadesDelAnio({
      anio: 2026,
      accionistas: ['ana', 'luis', 'nuevo'],
      aportes,
      interesesPagados: [{ mes: f('2026-04-01'), monto: 100_000 }],
    });
    expect(r.get('nuevo')?.[3].utilidad).toBe(0);
  });

  it('counts only the current period: contributions of a previous year are not accumulated', () => {
    const r = utilidadesDelAnio({
      anio: 2026,
      accionistas: ['ana', 'luis'],
      aportes: [...aportes, { accionistaId: 'luis', mes: f('2025-12-01'), monto: 9_000_000 }],
      interesesPagados: [{ mes: f('2026-04-01'), monto: 100_000 }],
    });
    expect(r.get('ana')?.[3].utilidad).toBe(30_000);
  });
});

describe('resumenDelPeriodo (admin indicator)', () => {
  const porMes = [0, 0, 0, 0, 0, 0, 0, 0, 33_333, 640_000, 0, 0];

  it('RN-6.1: the period total is the interest paid for every month of the year', () => {
    expect(resumenDelPeriodo({ interesesPorMes: porMes, mesActual: 11 }).total).toBe(673_333);
  });

  it('RN-4.22b: compares the last closed month with the one before, since the current month is paid later', () => {
    const r = resumenDelPeriodo({ interesesPorMes: porMes, mesActual: 11 });
    expect(r).toMatchObject({ ultimoMesCerrado: 640_000, mesAnterior: 33_333 });
    expect(r.variacion).toBeCloseTo(1820.0, 0);
  });

  it('without a previous month to compare there is no variation', () => {
    expect(resumenDelPeriodo({ interesesPorMes: porMes, mesActual: 9 }).variacion).toBeNull();
    expect(resumenDelPeriodo({ interesesPorMes: porMes, mesActual: 1 }).variacion).toBeNull();
  });
});

describe('interesesPorMesDelAnio (RN-6.1)', () => {
  it('adds the interest paid for each month of the year, January first, and ignores other years', () => {
    const r = interesesPorMesDelAnio({
      anio: 2026,
      interesesPagados: [
        { mes: f('2026-10-01'), monto: 440_000 },
        { mes: f('2026-10-01'), monto: 200_000 },
        { mes: f('2026-09-01'), monto: 33_333 },
        { mes: f('2025-12-01'), monto: 99_999 },
      ],
    });
    expect(r).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 33_333, 640_000, 0, 0]);
  });
});
