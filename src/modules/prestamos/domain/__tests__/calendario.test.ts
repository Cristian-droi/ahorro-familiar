import { describe, it, expect } from 'vitest';
import { crearFecha, type FechaISO } from '@/shared/domain/fechas';
import { mesAplicado, plazoDelPrestamo } from '@/modules/prestamos/domain/calendario';

// Default cut-off day from docs/reglas-negocio.md, section 10.
const DIA_DE_CORTE = 25;

function fecha(texto: string): FechaISO {
  const r = crearFecha(texto);
  if (!r.ok) throw new Error(`Invalid test date: ${texto}`);
  return r.value;
}

describe('mesAplicado (RN-4.15)', () => {
  it.each([
    ['2026-10-01', '2026-10-01'],
    ['2026-10-25', '2026-10-01'],
    ['2026-10-26', '2026-11-01'],
    ['2026-10-31', '2026-11-01'],
  ])('a disbursement on %s counts as %s', (desembolso, esperado) => {
    expect(mesAplicado(fecha(desembolso), DIA_DE_CORTE)).toBe(esperado);
  });

  it('moves a late-December disbursement to January of the next year', () => {
    expect(mesAplicado(fecha('2026-12-27'), DIA_DE_CORTE)).toBe('2027-01-01');
  });

  it('uses the configured cut-off day', () => {
    expect(mesAplicado(fecha('2026-10-21'), 20)).toBe('2026-11-01');
  });
});

describe('plazoDelPrestamo (RN-4.3)', () => {
  it.each([
    ['2026-01-01', 12],
    ['2026-10-01', 3],
    ['2026-12-01', 1],
  ])('by default a loan applied to %s runs %i months, until December of the period', (mes, meses) => {
    expect(plazoDelPrestamo({ mesAplicado: fecha(mes), hastaPeriodoSiguiente: false })).toEqual({
      meses,
      mesFinal: '2026-12-01',
    });
  });

  it('runs until December of the next period when the admin allows it', () => {
    expect(plazoDelPrestamo({ mesAplicado: fecha('2026-10-01'), hastaPeriodoSiguiente: true })).toEqual({
      meses: 15,
      mesFinal: '2027-12-01',
    });
  });

  it('measures the term from the applied month, not the disbursement day', () => {
    // RN-4.15 + RN-4.3: disbursed on 26 October, so it counts from November.
    const aplicado = mesAplicado(fecha('2026-10-26'), DIA_DE_CORTE);
    expect(plazoDelPrestamo({ mesAplicado: aplicado, hastaPeriodoSiguiente: false }).meses).toBe(2);
  });
});
