import { describe, it, expect } from 'vitest';
import { ajustarAccionesPorPrestamo, calcularAccionesPorPrestamo } from '@/modules/prestamos/domain/acciones-por-prestamo';

// Default step from docs/reglas-negocio.md (RN-4.10).
const PASO = 500000;

describe('calcularAccionesPorPrestamo (RN-4.10, RN-4.14)', () => {
  it.each([
    [900000, 2],
    [4840000, 10],
    [11000000, 22],
  ])('rounds %i up to %i shares', (monto, esperado) => {
    const r = calcularAccionesPorPrestamo({ monto, valorAccion: 50000, paso: PASO });
    expect(r.ok && r.value.cantidad).toBe(esperado);
  });

  it('gives exactly one share per step on exact multiples', () => {
    const r = calcularAccionesPorPrestamo({ monto: 1000000, valorAccion: 50000, paso: PASO });
    expect(r.ok && r.value.cantidad).toBe(2);
  });

  it('has no upper limit', () => {
    const r = calcularAccionesPorPrestamo({ monto: 50000001, valorAccion: 10000, paso: PASO });
    expect(r.ok && r.value.cantidad).toBe(101);
  });

  it('values each share at the shareholder share value: 900.000 at 50.000 → 100.000', () => {
    const r = calcularAccionesPorPrestamo({ monto: 900000, valorAccion: 50000, paso: PASO });
    expect(r).toEqual({ ok: true, value: { cantidad: 2, valor: 100000 } });
  });

  it('uses the configured step', () => {
    const r = calcularAccionesPorPrestamo({ monto: 900000, valorAccion: 25000, paso: 300000 });
    expect(r).toEqual({ ok: true, value: { cantidad: 3, valor: 75000 } });
  });

  it.each([0, -500000, 900000.5])('rejects an invalid amount %s', (monto) => {
    const r = calcularAccionesPorPrestamo({ monto, valorAccion: 50000, paso: PASO });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.codigo).toBe('monto_invalido');
      expect(r.error.mensaje).toBe('El monto del préstamo debe ser un número entero mayor que cero.');
    }
  });
});

describe('ajustarAccionesPorPrestamo (RN-4.12)', () => {
  it('RN-4.12: 11.000.000 suggests 22 shares; the exception to 20 at 50.000 is worth 1.000.000', () => {
    const r = ajustarAccionesPorPrestamo({ sugerida: 22, final: 20, valorAccion: 50000, motivo: 'Excepción aprobada' });
    expect(r).toEqual({ ok: true, value: { cantidad: 20, valor: 1000000, cambio: true } });
  });

  it('RN-4.12: a change without a reason is rejected', () => {
    const r = ajustarAccionesPorPrestamo({ sugerida: 22, final: 20, valorAccion: 50000, motivo: '   ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.codigo).toBe('motivo_obligatorio');
  });

  it('keeping the suggested count needs no reason', () => {
    const r = ajustarAccionesPorPrestamo({ sugerida: 22, final: 22, valorAccion: 50000, motivo: null });
    expect(r).toEqual({ ok: true, value: { cantidad: 22, valor: 1100000, cambio: false } });
  });

  it.each([-1, 2.5, Number.NaN])('rejects a count of %s', (final) => {
    const r = ajustarAccionesPorPrestamo({ sugerida: 22, final, valorAccion: 50000, motivo: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.codigo).toBe('cantidad_invalida');
  });

  it('allows zero shares as an exception with a reason', () => {
    const r = ajustarAccionesPorPrestamo({ sugerida: 2, final: 0, valorAccion: 50000, motivo: 'Exonerado' });
    expect(r).toEqual({ ok: true, value: { cantidad: 0, valor: 0, cambio: true } });
  });
});
