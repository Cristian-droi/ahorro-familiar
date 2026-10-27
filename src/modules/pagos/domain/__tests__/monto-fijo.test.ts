import { describe, it, expect } from 'vitest';
import { distribuirMontoFijo } from '@/modules/pagos/domain/monto-fijo';

const reglas = { minAccionesPorMes: 1, maxAccionesPorMes: 10 };

const futuros = ['2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01'].map((mes) => ({
  mes,
  valorAccion: 25000,
}));

// The RN-4.29c example: 20.000 of interest, one month behind with a 15.000
// fine, the current month without a fine, a loan owing 100.000, 300.000 sent.
const ejemplo = {
  prestamos: [{ id: 'A', interesesPendientes: 20000, saldoCapital: 100000 }],
  mesesAtrasados: [{ mes: '2026-09-01', valorAccion: 25000, multa: 15000 }],
  mesActual: { mes: '2026-10-01', valorAccion: 25000, multa: 0 },
  mesesFuturos: futuros,
  reglas,
};

describe('distribuirMontoFijo (RN-4.29c)', () => {
  it('matches the rule example when the shareholder advances shares', () => {
    const r = distribuirMontoFijo({ ...ejemplo, monto: 300000, adelantarAcciones: true });
    expect(r).toEqual({
      ok: true,
      value: {
        intereses: [{ id: 'A', monto: 20000 }],
        meses: [
          { mes: '2026-09-01', acciones: 1, valorAcciones: 25000, multa: 15000 },
          { mes: '2026-10-01', acciones: 1, valorAcciones: 25000, multa: 0 },
        ],
        capital: [{ id: 'A', monto: 100000, saldoRestante: 0 }],
        mesesFuturos: [
          { mes: '2026-11-01', acciones: 1, valorAcciones: 25000 },
          { mes: '2026-12-01', acciones: 1, valorAcciones: 25000 },
          { mes: '2027-01-01', acciones: 1, valorAcciones: 25000 },
          { mes: '2027-02-01', acciones: 1, valorAcciones: 25000 },
        ],
        rechazado: 15000,
      },
    });
  });

  it('rejects the whole leftover when the shareholder does not advance shares', () => {
    const r = distribuirMontoFijo({ ...ejemplo, monto: 300000, adelantarAcciones: false });
    expect(r.ok && r.value.mesesFuturos).toEqual([]);
    expect(r.ok && r.value.rechazado).toBe(115000);
  });

  it('pays interest of every loan first, partially if the amount falls short (RN-4.25)', () => {
    const r = distribuirMontoFijo({
      ...ejemplo,
      prestamos: [
        { id: 'A', interesesPendientes: 20000, saldoCapital: 100000 },
        { id: 'B', interesesPendientes: 30000, saldoCapital: 500000 },
      ],
      monto: 35000,
      adelantarAcciones: false,
    });
    expect(r.ok && r.value).toEqual({
      intereses: [
        { id: 'A', monto: 20000 },
        { id: 'B', monto: 15000 },
      ],
      meses: [],
      capital: [],
      mesesFuturos: [],
      rechazado: 0,
    });
  });

  it('pays overdue months from the oldest, each one with its own fine', () => {
    const r = distribuirMontoFijo({
      ...ejemplo,
      prestamos: [],
      mesesAtrasados: [
        { mes: '2026-08-01', valorAccion: 25000, multa: 15000 },
        { mes: '2026-09-01', valorAccion: 25000, multa: 15000 },
      ],
      mesActual: null,
      monto: 80000,
      adelantarAcciones: false,
    });
    expect(r.ok && r.value.meses).toEqual([
      { mes: '2026-08-01', acciones: 1, valorAcciones: 25000, multa: 15000 },
      { mes: '2026-09-01', acciones: 1, valorAcciones: 25000, multa: 15000 },
    ]);
    expect(r.ok && r.value.rechazado).toBe(0);
  });

  it('matches the RN-4.29 example: capital goes to the chosen loans in order', () => {
    const r = distribuirMontoFijo({
      prestamos: [
        { id: 'A', interesesPendientes: 0, saldoCapital: 1200000 },
        { id: 'B', interesesPendientes: 0, saldoCapital: 2023688 },
      ],
      mesesAtrasados: [],
      mesActual: null,
      mesesFuturos: [],
      monto: 1224389,
      adelantarAcciones: false,
      reglas,
    });
    expect(r.ok && r.value.capital).toEqual([
      { id: 'A', monto: 1200000, saldoRestante: 0 },
      { id: 'B', monto: 24389, saldoRestante: 1999299 },
    ]);
  });

  it('charges the minimum shares per month from the rules (RN-3.1)', () => {
    const r = distribuirMontoFijo({
      ...ejemplo,
      prestamos: [],
      mesesAtrasados: [],
      monto: 50000,
      adelantarAcciones: false,
      reglas: { minAccionesPorMes: 2, maxAccionesPorMes: 10 },
    });
    expect(r.ok && r.value.meses).toEqual([{ mes: '2026-10-01', acciones: 2, valorAcciones: 50000, multa: 0 }]);
  });

  it('only advances whole future months and stops when there are no more months', () => {
    const r = distribuirMontoFijo({
      ...ejemplo,
      prestamos: [],
      mesesAtrasados: [],
      mesActual: null,
      mesesFuturos: futuros.slice(0, 2),
      monto: 80000,
      adelantarAcciones: true,
    });
    expect(r.ok && r.value.mesesFuturos.length).toBe(2);
    expect(r.ok && r.value.rechazado).toBe(30000);
  });

  it('assumption: an overdue month is paid whole or not at all, and the rest is rejected', () => {
    // 30.000 does not cover the 25.000 share plus the 15.000 fine, so nothing
    // can go to newer months or to capital before it.
    const r = distribuirMontoFijo({ ...ejemplo, monto: 50000, adelantarAcciones: true });
    expect(r.ok && r.value).toEqual({
      intereses: [{ id: 'A', monto: 20000 }],
      meses: [],
      capital: [],
      mesesFuturos: [],
      rechazado: 30000,
    });
  });

  it.each([
    [{ monto: 0 }, 'pago_invalido'],
    [{ monto: 10.5 }, 'pago_invalido'],
    [{ prestamos: [{ id: 'A', interesesPendientes: -1, saldoCapital: 100 }] }, 'valor_invalido'],
    [{ mesActual: { mes: '2026-10-01', valorAccion: 0, multa: 0 } }, 'valor_invalido'],
    [{ mesesAtrasados: [{ mes: '2026-09-01', valorAccion: 25000, multa: -5 }] }, 'valor_invalido'],
  ])('returns an error for %o', (cambio, codigo) => {
    const r = distribuirMontoFijo({ ...ejemplo, monto: 300000, adelantarAcciones: false, ...cambio });
    expect(!r.ok && r.error.codigo).toBe(codigo);
  });
});
