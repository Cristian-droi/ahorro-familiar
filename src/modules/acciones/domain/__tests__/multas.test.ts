import { describe, it, expect } from 'vitest';
import { crearFecha, type FechaISO } from '@/shared/domain/fechas';
import {
  multaDelMesEnCurso,
  calcularMulta,
  type ReglasDeMulta,
} from '@/modules/acciones/domain/multas';

// Default parameters from docs/reglas-negocio.md, section 10.
const REGLAS: ReglasDeMulta = {
  diasDeGracia: 10,
  multaPorDia: 500,
  topeMensual: 15000,
  multaPorMesCompleto: 15000,
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

describe('calcularMulta (RN-3.4)', () => {
  it('matches the rule example: last purchase in July, today is 20 September → 20.000', () => {
    // First month without a purchase is August.
    const multa = calcularMulta({
      primerMesPendiente: fecha('2026-08-01'),
      hoy: fecha('2026-09-20'),
      reglas: REGLAS,
    });
    expect(multa).toEqual({ mesesCompletos: 1, multaMesesCompletos: 15000, multaMesEnCurso: 5000, total: 20000 });
  });

  it('owes nothing when the current month is already bought', () => {
    const multa = calcularMulta({
      primerMesPendiente: fecha('2026-10-01'),
      hoy: fecha('2026-09-20'),
      reglas: REGLAS,
    });
    expect(multa.total).toBe(0);
  });

  it('owes nothing when bought in advance for future months', () => {
    const multa = calcularMulta({
      primerMesPendiente: fecha('2026-12-01'),
      hoy: fecha('2026-09-28'),
      reglas: REGLAS,
    });
    expect(multa).toEqual({ mesesCompletos: 0, multaMesesCompletos: 0, multaMesEnCurso: 0, total: 0 });
  });

  it('charges only the current month when it is the first pending one', () => {
    const multa = calcularMulta({
      primerMesPendiente: fecha('2026-09-01'),
      hoy: fecha('2026-09-15'),
      reglas: REGLAS,
    });
    expect(multa).toEqual({ mesesCompletos: 0, multaMesesCompletos: 0, multaMesEnCurso: 2500, total: 2500 });
  });

  it('owes nothing for the current month during the grace period', () => {
    const multa = calcularMulta({
      primerMesPendiente: fecha('2026-09-01'),
      hoy: fecha('2026-09-08'),
      reglas: REGLAS,
    });
    expect(multa.total).toBe(0);
  });

  it('charges each full month across a year boundary', () => {
    const multa = calcularMulta({
      primerMesPendiente: fecha('2026-11-01'),
      hoy: fecha('2027-01-15'),
      reglas: REGLAS,
    });
    expect(multa).toEqual({ mesesCompletos: 2, multaMesesCompletos: 30000, multaMesEnCurso: 2500, total: 32500 });
  });

  it('uses the configured full-month fine', () => {
    const multa = calcularMulta({
      primerMesPendiente: fecha('2026-07-01'),
      hoy: fecha('2026-09-05'),
      reglas: { ...REGLAS, multaPorMesCompleto: 10000 },
    });
    expect(multa.total).toBe(20000);
  });
});
