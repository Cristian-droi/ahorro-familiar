import { describe, it, expect } from 'vitest';
import { calcularAccionesPorPrestamo } from '@/modules/prestamos/domain/acciones-por-prestamo';

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
