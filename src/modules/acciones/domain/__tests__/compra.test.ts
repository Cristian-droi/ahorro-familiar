import { describe, it, expect } from 'vitest';
import { validarCantidadDeAcciones, type ReglasDeCompra } from '@/modules/acciones/domain/compra';

// Default parameters from docs/reglas-negocio.md, section 10.
const REGLAS: ReglasDeCompra = { minAccionesPorMes: 1, maxAccionesPorMes: 10 };

describe('validarCantidadDeAcciones (RN-3.1)', () => {
  it.each([1, 5, 10])('accepts %i shares', (cantidad) => {
    expect(validarCantidadDeAcciones(cantidad, REGLAS)).toEqual({ ok: true, value: cantidad });
  });

  it.each([0, 11, -1])('rejects %i shares as out of range', (cantidad) => {
    const r = validarCantidadDeAcciones(cantidad, REGLAS);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.codigo).toBe('cantidad_fuera_de_rango');
      expect(r.error.mensaje).toBe('Puedes comprar entre 1 y 10 acciones por mes.');
    }
  });

  it.each([2.5, Number.NaN])('rejects %s as not a whole number', (cantidad) => {
    const r = validarCantidadDeAcciones(cantidad, REGLAS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.codigo).toBe('cantidad_no_entera');
  });

  it('uses the configured limits', () => {
    const reglas = { minAccionesPorMes: 2, maxAccionesPorMes: 4 };
    expect(validarCantidadDeAcciones(5, reglas).ok).toBe(false);
    expect(validarCantidadDeAcciones(4, reglas).ok).toBe(true);
  });
});
