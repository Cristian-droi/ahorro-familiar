import { describe, it, expect } from 'vitest';
import { crearFecha, type FechaISO } from '@/shared/domain/fechas';
import { DIAS_DE_VIGENCIA_DE_SOLICITUD, solicitudVencida } from '@/modules/prestamos/domain/vigencia';

function fecha(texto: string): FechaISO {
  const r = crearFecha(texto);
  if (!r.ok) throw new Error(`Invalid test date: ${texto}`);
  return r.value;
}

const vencida = (enviadaEl: string, hoy: string) =>
  solicitudVencida({ enviadaEl: fecha(enviadaEl), hoy: fecha(hoy), diasDeVigencia: DIAS_DE_VIGENCIA_DE_SOLICITUD });

describe('solicitudVencida (RN-4.5b)', () => {
  it('RN-4.5b: the validity is 15 days', () => {
    expect(DIAS_DE_VIGENCIA_DE_SOLICITUD).toBe(15);
  });

  it('RN-4.5b: the same day it is sent the request is valid', () => {
    expect(vencida('2026-10-01', '2026-10-01')).toBe(false);
  });

  it('RN-4.5b: 15 days after it is sent the request is still valid', () => {
    expect(vencida('2026-10-01', '2026-10-16')).toBe(false);
  });

  it('RN-4.5b: more than 15 days after it is sent the request is expired', () => {
    expect(vencida('2026-10-01', '2026-10-17')).toBe(true);
  });

  it('RN-4.5b: counts calendar days across months and years', () => {
    expect(vencida('2026-12-20', '2027-01-04')).toBe(false);
    expect(vencida('2026-12-20', '2027-01-05')).toBe(true);
  });

  it('a send date after today is not expired', () => {
    expect(vencida('2026-10-20', '2026-10-01')).toBe(false);
  });
});
