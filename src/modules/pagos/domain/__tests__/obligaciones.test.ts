import { describe, it, expect } from 'vitest';
import { estadoDeObligaciones, type EntradaDeObligaciones } from '@/modules/pagos/domain/obligaciones';
import type { FechaISO } from '@/shared/domain/fechas';

const f = (texto: string) => texto as FechaISO;

const REGLAS: EntradaDeObligaciones['reglas'] = {
  compra: { minAccionesPorMes: 1, maxAccionesPorMes: 10 },
  multa: { diasDeGracia: 10, multaPorDia: 500, topeMensual: 15000 },
};

function entrada(cambios: Partial<EntradaDeObligaciones>): EntradaDeObligaciones {
  return {
    hoy: f('2026-01-05'),
    reglas: REGLAS,
    valorDeAccion: 25000,
    accionesCompradas: [],
    mesesConMultaPagada: [],
    prestamos: [],
    ...cambios,
  };
}

describe('estadoDeObligaciones (RN-3.1, RN-3.4, RN-2.3, RN-4.22)', () => {
  it('RN-3.4: does not require the current month during its grace days', () => {
    const r = estadoDeObligaciones(entrada({ hoy: f('2026-01-10') }));
    expect(r.mesesEnMora).toEqual([]);
    expect(r.alDia).toBe(true);
    expect(r.razones).toEqual([]);
  });

  it('RN-3.1/RN-3.4: a past month without the minimum owes its shares and its fine', () => {
    // 2 September: August is 23 days late: 11.500 (RN-3.4 example).
    const r = estadoDeObligaciones(
      entrada({
        hoy: f('2026-09-02'),
        accionesCompradas: [1, 2, 3, 4, 5, 6, 7].map((m) => ({
          mes: f(`2026-0${m}-01`),
          acciones: 1,
        })),
      }),
    );
    expect(r.mesesEnMora).toEqual([
      { mes: '2026-08-01', nombreDelMes: 'Agosto', accionesAdeudadas: 1, valorDeAccion: 25000, multa: 11500 },
    ]);
    expect(r.razones).toEqual([
      'Debés comprar el mínimo de acciones (1) para Agosto 2026.',
      'Tenés una multa pendiente por mora en acciones de Agosto 2026.',
    ]);
    expect(r).toMatchObject({
      alDia: false,
      faltanAcciones: true,
      multasPendientes: true,
      accionesAdeudadas: 1,
      montoAcciones: 25000,
      montoMultas: 11500,
      total: 36500,
    });
  });

  it('RN-3.1: adds up shares bought in several items of the same month', () => {
    const r = estadoDeObligaciones(
      entrada({
        hoy: f('2026-02-20'),
        reglas: { ...REGLAS, compra: { minAccionesPorMes: 3, maxAccionesPorMes: 10 } },
        accionesCompradas: [
          { mes: f('2026-01-01'), acciones: 1 },
          { mes: f('2026-01-01'), acciones: 2 },
          { mes: f('2026-02-01'), acciones: 2 },
        ],
      }),
    );
    expect(r.mesesEnMora.map((m) => [m.mes, m.accionesAdeudadas])).toEqual([['2026-02-01', 1]]);
  });

  it('RN-3.4: a month whose fine was paid owes only its shares', () => {
    const r = estadoDeObligaciones(
      entrada({ hoy: f('2026-03-15'), mesesConMultaPagada: [f('2026-01-01')] }),
    );
    expect(r.mesesEnMora).toEqual([
      { mes: '2026-01-01', nombreDelMes: 'Enero', accionesAdeudadas: 1, valorDeAccion: 25000, multa: 0 },
      { mes: '2026-02-01', nombreDelMes: 'Febrero', accionesAdeudadas: 1, valorDeAccion: 25000, multa: 15000 },
      { mes: '2026-03-01', nombreDelMes: 'Marzo', accionesAdeudadas: 1, valorDeAccion: 25000, multa: 2500 },
    ]);
    expect(r.montoMultas).toBe(17500);
    expect(r.razones).not.toContain('Tenés una multa pendiente por mora en acciones de Enero 2026.');
  });

  it('RN-2.3: without a share value the share amount is 0 but fines still accrue', () => {
    const r = estadoDeObligaciones(entrada({ hoy: f('2026-02-20'), valorDeAccion: null }));
    expect(r.razones[0]).toBe('Primero elige el valor de tu acción para este periodo.');
    expect(r.valorDeAccion).toBeNull();
    expect(r.faltanAcciones).toBe(true);
    expect(r.montoAcciones).toBe(0);
    expect(r.mesesEnMora.map((m) => [m.valorDeAccion, m.multa])).toEqual([
      [0, 15000],
      [0, 5000],
    ]);
    expect(r.montoMultas).toBe(20000);
    expect(r.total).toBe(20000);
  });

  it('RN-2.3: a missing share value alone keeps the shareholder not up to date', () => {
    const r = estadoDeObligaciones(entrada({ valorDeAccion: null }));
    expect(r.alDia).toBe(false);
    expect(r.razones).toEqual(['Primero elige el valor de tu acción para este periodo.']);
  });

  it('RN-4.22: adds the interest owed of each active loan', () => {
    const r = estadoDeObligaciones(
      entrada({
        prestamos: [
          { id: 'A', numero: 7, numeroDeDesembolso: 'D-1', saldo: 1000000, interesAdeudado: 20000 },
          { id: 'B', numero: null, numeroDeDesembolso: null, saldo: 500000, interesAdeudado: 0 },
          { id: 'C', numero: 9, numeroDeDesembolso: null, saldo: 300000, interesAdeudado: 5000 },
        ],
      }),
    );
    expect(r.razones).toEqual([
      'Tenés intereses en mora en tu Préstamo #7 (D-1).',
      'Tenés intereses en mora en tu Préstamo #9.',
    ]);
    expect(r).toMatchObject({ debeIntereses: true, montoIntereses: 25000, total: 25000, alDia: false });
    expect(r.prestamos.map((p) => p.id)).toEqual(['A', 'B', 'C']);
  });

  it('RN-4.22: names a loan without number as the active loan', () => {
    const r = estadoDeObligaciones(
      entrada({ prestamos: [{ id: 'A', numero: null, numeroDeDesembolso: 'D-1', saldo: 0, interesAdeudado: 1 }] }),
    );
    expect(r.razones).toEqual(['Tenés intereses en mora en tu préstamo activo.']);
  });

  it('RN-3.1/RN-4.22: is up to date when nothing is owed', () => {
    const r = estadoDeObligaciones(
      entrada({
        hoy: f('2026-03-15'),
        accionesCompradas: [1, 2, 3].map((m) => ({ mes: f(`2026-0${m}-01`), acciones: 1 })),
        prestamos: [{ id: 'A', numero: 1, numeroDeDesembolso: null, saldo: 100, interesAdeudado: 0 }],
      }),
    );
    expect(r).toEqual({
      alDia: true,
      razones: [],
      faltanAcciones: false,
      valorDeAccion: 25000,
      multasPendientes: false,
      debeIntereses: false,
      accionesAdeudadas: 0,
      montoAcciones: 0,
      montoMultas: 0,
      montoIntereses: 0,
      total: 0,
      mesesEnMora: [],
      prestamos: [{ id: 'A', numero: 1, numeroDeDesembolso: null, saldo: 100, interesAdeudado: 0 }],
    });
  });
});
