import { describe, it, expect } from 'vitest';
import { crearFecha, type FechaISO } from '@/shared/domain/fechas';
import { cuotaParaCerrarElAnio } from '@/modules/prestamos/domain/cuota-de-cierre';

function fecha(texto: string): FechaISO {
  const r = crearFecha(texto);
  if (!r.ok) throw new Error(`Invalid test date: ${texto}`);
  return r.value;
}

const ENERO = fecha('2026-01-01');
const DICIEMBRE = fecha('2026-12-01');

describe('cuotaParaCerrarElAnio (section 4.7, RN-4.30)', () => {
  it('matches the rule example: 900.000 in October with 3 months left → 300.000', () => {
    const r = cuotaParaCerrarElAnio({ mesInicial: ENERO, saldo: 900000, mesActual: fecha('2026-10-14'), mesFinal: DICIEMBRE });
    expect(r).toEqual({ ok: true, value: 300000 });
  });

  it('rounds up a non-exact division: 1.000.000 in October → 333.334', () => {
    const r = cuotaParaCerrarElAnio({ mesInicial: ENERO, saldo: 1000000, mesActual: fecha('2026-10-01'), mesFinal: DICIEMBRE });
    expect(r).toEqual({ ok: true, value: 333334 });
  });

  it('asks for the whole balance in December', () => {
    const r = cuotaParaCerrarElAnio({ mesInicial: ENERO, saldo: 450001, mesActual: fecha('2026-12-20'), mesFinal: DICIEMBRE });
    expect(r).toEqual({ ok: true, value: 450001 });
  });

  it('is zero for a paid-off loan', () => {
    const r = cuotaParaCerrarElAnio({ mesInicial: ENERO, saldo: 0, mesActual: fecha('2026-10-01'), mesFinal: DICIEMBRE });
    expect(r).toEqual({ ok: true, value: 0 });
  });

  it('spreads an extended loan until the last month of its term', () => {
    const r = cuotaParaCerrarElAnio({
      mesInicial: ENERO,
      saldo: 1500000,
      mesActual: fecha('2026-10-01'),
      mesFinal: fecha('2027-12-01'),
    });
    expect(r).toEqual({ ok: true, value: 100000 });
  });

  it('rejects a month after the end of the term', () => {
    const r = cuotaParaCerrarElAnio({ mesInicial: ENERO, saldo: 100000, mesActual: fecha('2027-01-05'), mesFinal: DICIEMBRE });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.codigo).toBe('fuera_del_plazo');
      expect(r.error.mensaje).toBe('El mes actual es posterior al último mes del plazo del préstamo.');
    }
  });

  it('rejects a month before the applied month of the loan', () => {
    // RN-4.15: disbursed on 26 October, so the term runs November–December.
    const r = cuotaParaCerrarElAnio({
      saldo: 1000000,
      mesInicial: fecha('2026-11-01'),
      mesActual: fecha('2026-10-28'),
      mesFinal: DICIEMBRE,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.codigo).toBe('antes_del_plazo');
      expect(r.error.mensaje).toBe('El préstamo todavía no empieza: su primer mes es posterior al mes actual.');
    }
  });

  it('spreads the balance over the real term from its applied month', () => {
    const r = cuotaParaCerrarElAnio({
      saldo: 1000000,
      mesInicial: fecha('2026-11-01'),
      mesActual: fecha('2026-11-03'),
      mesFinal: DICIEMBRE,
    });
    expect(r).toEqual({ ok: true, value: 500000 });
  });

  it.each([-1, 100.5])('rejects an invalid balance %s', (saldo) => {
    const r = cuotaParaCerrarElAnio({ mesInicial: ENERO, saldo, mesActual: fecha('2026-10-01'), mesFinal: DICIEMBRE });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.codigo).toBe('saldo_invalido');
  });
});
