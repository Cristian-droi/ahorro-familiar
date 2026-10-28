import { describe, it, expect } from 'vitest';
import { crearFecha, type FechaISO } from '@/shared/domain/fechas';
import {
  multaDelMesEnCurso,
  calcularMulta,
  multaDelMes,
  type ReglasDeMulta,
} from '@/modules/acciones/domain/multas';

// Default parameters from docs/reglas-negocio.md, section 10.
const REGLAS: ReglasDeMulta = {
  diasDeGracia: 10,
  multaPorDia: 500,
  topeMensual: 15000,
};

function fecha(texto: string): FechaISO {
  const r = crearFecha(texto);
  if (!r.ok) throw new Error(`Invalid test date: ${texto}`);
  return r.value;
}

describe('multaDelMesEnCurso (RN-3.4)', () => {
  it.each([
    [1, 0],
    [10, 0],
    [11, 500],
    [20, 5000],
  ])('day %i of the current month owes %i', (dia, esperado) => {
    expect(multaDelMesEnCurso(dia, REGLAS)).toBe(esperado);
  });

  it('caps the current month at the monthly limit', () => {
    expect(multaDelMesEnCurso(31, REGLAS)).toBe(10500);
    expect(multaDelMesEnCurso(31, { ...REGLAS, multaPorDia: 1000 })).toBe(15000);
  });

  it('uses the configured grace days', () => {
    expect(multaDelMesEnCurso(12, { ...REGLAS, diasDeGracia: 5 })).toBe(3500);
  });
});

describe('multaDelMes (RN-3.4)', () => {
  it.each([
    ['2026-08-01', '2026-08-10', 0],
    ['2026-08-01', '2026-08-11', 500],
    // Cris, 2026-10-27: a past month keeps adding 500 a day until the cap.
    ['2026-08-01', '2026-09-02', 11500],
    ['2026-08-01', '2026-09-09', 15000],
    ['2026-08-01', '2026-12-31', 15000],
    ['2026-10-01', '2026-09-20', 0],
  ])('month %s on %s owes %i', (mes, hoy, esperado) => {
    expect(multaDelMes({ mes: fecha(mes), hoy: fecha(hoy), reglas: REGLAS })).toBe(esperado);
  });
});

describe('calcularMulta (RN-3.4)', () => {
  it('matches the rule example: last purchase in July, today is 20 September → 20.000', () => {
    // First month without a purchase is August.
    const multa = calcularMulta({
      primerMesPendiente: fecha('2026-08-01'),
      hoy: fecha('2026-09-20'),
      reglas: REGLAS,
    });
    expect(multa).toEqual({
      porMes: [
        { mes: '2026-08-01', multa: 15000 },
        { mes: '2026-09-01', multa: 5000 },
      ],
      total: 20000,
    });
  });

  it('owes nothing when the current month is already bought', () => {
    const multa = calcularMulta({
      primerMesPendiente: fecha('2026-10-01'),
      hoy: fecha('2026-09-20'),
      reglas: REGLAS,
    });
    expect(multa).toEqual({ porMes: [], total: 0 });
  });

  it('owes nothing when bought in advance for future months', () => {
    const multa = calcularMulta({
      primerMesPendiente: fecha('2026-12-01'),
      hoy: fecha('2026-09-28'),
      reglas: REGLAS,
    });
    expect(multa.total).toBe(0);
  });

  it('charges a past month by its days late until the cap', () => {
    const multa = calcularMulta({
      primerMesPendiente: fecha('2026-08-01'),
      hoy: fecha('2026-09-02'),
      reglas: REGLAS,
    });
    expect(multa).toEqual({
      porMes: [
        { mes: '2026-08-01', multa: 11500 },
        { mes: '2026-09-01', multa: 0 },
      ],
      total: 11500,
    });
  });

  it('owes nothing for the current month during the grace period', () => {
    const multa = calcularMulta({
      primerMesPendiente: fecha('2026-09-01'),
      hoy: fecha('2026-09-08'),
      reglas: REGLAS,
    });
    expect(multa.total).toBe(0);
  });

  it('charges each month across a year boundary', () => {
    const multa = calcularMulta({
      primerMesPendiente: fecha('2026-11-01'),
      hoy: fecha('2027-01-15'),
      reglas: REGLAS,
    });
    expect(multa.total).toBe(32500);
  });

  it('uses the configured daily fine and cap', () => {
    const multa = calcularMulta({
      primerMesPendiente: fecha('2026-09-01'),
      hoy: fecha('2026-09-20'),
      reglas: { ...REGLAS, multaPorDia: 1000, topeMensual: 8000 },
    });
    expect(multa.total).toBe(8000);
  });
});
