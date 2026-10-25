import { describe, it, expect } from 'vitest';
import {
  crearFecha,
  hoyBogota,
  diaDelMes,
  primerDiaDelMes,
  mesSiguiente,
  type FechaISO,
} from '@/shared/domain/fechas';

// Test helper: builds a known-valid date or fails the test.
function fecha(texto: string): FechaISO {
  const r = crearFecha(texto);
  if (!r.ok) throw new Error(`Invalid test date: ${texto}`);
  return r.value;
}

describe('crearFecha', () => {
  it('accepts a valid YYYY-MM-DD date', () => {
    expect(crearFecha('2026-10-19')).toEqual({ ok: true, value: '2026-10-19' });
  });

  it.each(['2028-02-29', '2000-02-29', '2026-04-30', '2026-12-31'])('accepts %s', (texto) => {
    expect(crearFecha(texto).ok).toBe(true);
  });

  it.each(['2026-02-30', '2027-02-29', '2100-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-1-5', '19/10/2026', ''])(
    'rejects %s',
    (texto) => {
      const r = crearFecha(texto);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.codigo).toBe('fecha_invalida');
    },
  );
});

describe('hoyBogota (America/Bogota, UTC-5, no DST)', () => {
  it('returns the previous calendar day before 05:00 UTC', () => {
    expect(hoyBogota(new Date('2026-10-19T04:59:59Z'))).toBe('2026-10-18');
  });

  it('returns the same calendar day from 05:00 UTC', () => {
    expect(hoyBogota(new Date('2026-10-19T05:00:00Z'))).toBe('2026-10-19');
  });

  it('crosses the year boundary in Bogota time', () => {
    expect(hoyBogota(new Date('2027-01-01T02:00:00Z'))).toBe('2026-12-31');
  });
});

describe('diaDelMes', () => {
  it('returns the day number', () => {
    expect(diaDelMes(fecha('2026-03-28'))).toBe(28);
  });
});

describe('primerDiaDelMes', () => {
  it('returns the first day of the same month', () => {
    expect(primerDiaDelMes(fecha('2026-03-28'))).toBe('2026-03-01');
  });
});

describe('mesSiguiente', () => {
  it('returns the first day of the next month', () => {
    expect(mesSiguiente(fecha('2026-03-28'))).toBe('2026-04-01');
  });

  it('rolls over to January of the next year', () => {
    expect(mesSiguiente(fecha('2026-12-15'))).toBe('2027-01-01');
  });
});
