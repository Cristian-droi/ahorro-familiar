import { describe, it, expect } from 'vitest';
import {
  AJUSTES_DE_PRESTAMO_POR_DEFECTO,
  validarAjustesDePrestamo,
  validarDiaDeCorte,
  validarDiaLimiteTasaCompleta,
  validarFraccion,
  validarMaximoDePrestamosActivos,
  validarPlazoHastaPeriodoSiguiente,
  validarReglasDeCompra,
  validarValoresDeAccion,
} from '@/modules/parametros/domain/parametros';

describe('AJUSTES_DE_PRESTAMO_POR_DEFECTO (section 10)', () => {
  it('uses day 15, day 25 and no extended term', () => {
    expect(AJUSTES_DE_PRESTAMO_POR_DEFECTO).toEqual({
      diaLimiteTasaCompleta: 15,
      diaDeCorte: 25,
      plazoHastaPeriodoSiguiente: false,
    });
  });
});

describe('validarDiaLimiteTasaCompleta (RN-4.20)', () => {
  it.each([1, 15, 27, '16'])('accepts %s', (valor) => {
    expect(validarDiaLimiteTasaCompleta(valor)).toEqual({ ok: true, value: Number(valor) });
  });

  it.each([0, 28, 15.5, 'quince', null, -1])('rejects %s', (valor) => {
    const r = validarDiaLimiteTasaCompleta(valor);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.codigo).toBe('dia_limite_invalido');
      expect(r.error.mensaje).toBe('El día límite para la tasa completa debe ser un número entero entre 1 y 27.');
    }
  });
});

describe('validarDiaDeCorte (RN-4.15, RN-4.21)', () => {
  it.each([2, 25, 28])('accepts %s', (valor) => {
    expect(validarDiaDeCorte(valor)).toEqual({ ok: true, value: valor });
  });

  it.each([1, 29, 31, 24.9, '', undefined])('rejects %s', (valor) => {
    const r = validarDiaDeCorte(valor);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.codigo).toBe('dia_de_corte_invalido');
      expect(r.error.mensaje).toBe('El día de corte debe ser un número entero entre 2 y 28.');
    }
  });
});

describe('validarPlazoHastaPeriodoSiguiente (RN-4.3)', () => {
  it.each([true, false])('accepts %s', (valor) => {
    expect(validarPlazoHastaPeriodoSiguiente(valor)).toEqual({ ok: true, value: valor });
  });

  it.each(['true', 1, null])('rejects %s', (valor) => {
    const r = validarPlazoHastaPeriodoSiguiente(valor);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.mensaje).toBe('El plazo hasta diciembre del periodo siguiente debe ser sí o no.');
  });
});

describe('validarAjustesDePrestamo (RN-4.20, RN-4.21, RN-4.3)', () => {
  it('accepts the defaults', () => {
    expect(validarAjustesDePrestamo({ diaLimiteTasaCompleta: 15, diaDeCorte: 25, plazoHastaPeriodoSiguiente: false })).toEqual({
      ok: true,
      value: AJUSTES_DE_PRESTAMO_POR_DEFECTO,
    });
  });

  it('rejects a day limit that is not before the cut-off day (RN-4.21: half rate from the day after the limit up to the cut-off)', () => {
    const r = validarAjustesDePrestamo({ diaLimiteTasaCompleta: 25, diaDeCorte: 25, plazoHastaPeriodoSiguiente: false });
    expect(r).toEqual({
      ok: false,
      error: {
        codigo: 'dias_de_prestamo_inconsistentes',
        mensaje: 'El día límite para la tasa completa (25) debe ser menor que el día de corte (25).',
      },
    });
  });

  it('returns the first invalid field', () => {
    const r = validarAjustesDePrestamo({ diaLimiteTasaCompleta: 15, diaDeCorte: 30, plazoHastaPeriodoSiguiente: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.codigo).toBe('dia_de_corte_invalido');
  });
});

describe('validarFraccion (RN-4.16, RN-4.18, section 10 percentages)', () => {
  it.each([0, 0.004, 0.02, 1, '0.3'])('accepts %s', (valor) => {
    expect(validarFraccion(valor, 'La tasa de interés')).toEqual({ ok: true, value: Number(valor) });
  });

  it.each([-0.01, 1.5, 'dos', null])('rejects %s', (valor) => {
    const r = validarFraccion(valor, 'La tasa de interés');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.codigo).toBe('fraccion_invalida');
      expect(r.error.mensaje).toBe('La tasa de interés debe estar entre 0% y 100%.');
    }
  });
});

describe('validarValoresDeAccion (RN-2, section 10)', () => {
  it('accepts positive whole values and returns them sorted', () => {
    expect(validarValoresDeAccion([50_000, 10_000, 25_000])).toEqual({ ok: true, value: [10_000, 25_000, 50_000] });
  });

  it.each([[[]], [[10_000, 10_000]], [[0]], [[10_000.5]], ['10000'], [null]])('rejects %j', (valor) => {
    const r = validarValoresDeAccion(valor);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.codigo).toBe('valores_de_accion_invalidos');
  });
});

describe('validarReglasDeCompra (RN-3.1, RN-3.4)', () => {
  const reglas = {
    min_shares_per_month: 1,
    max_shares_per_month: 10,
    fine_per_day: 500,
    fine_max_per_month: 15_000,
    grace_period_days: 10,
  };

  it('accepts the defaults', () => {
    expect(validarReglasDeCompra(reglas)).toEqual({ ok: true, value: reglas });
  });

  it('rejects a minimum above the maximum', () => {
    const r = validarReglasDeCompra({ ...reglas, min_shares_per_month: 11 });
    expect(r).toEqual({
      ok: false,
      error: {
        codigo: 'reglas_de_compra_invalidas',
        mensaje: 'El mínimo de acciones por mes (11) no puede ser mayor que el máximo (10).',
      },
    });
  });

  it.each([
    ['min_shares_per_month', 0],
    ['max_shares_per_month', 2.5],
    ['fine_per_day', -1],
    ['fine_max_per_month', '15000'],
    ['grace_period_days', 29],
  ])('rejects %s = %j', (campo, valor) => {
    const r = validarReglasDeCompra({ ...reglas, [campo]: valor });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.codigo).toBe('reglas_de_compra_invalidas');
  });

  it('rejects a value that is not an object', () => {
    expect(validarReglasDeCompra('reglas').ok).toBe(false);
  });
});

describe('validarMaximoDePrestamosActivos (RN-4.2)', () => {
  it.each([1, 2, 20])('accepts %s', (valor) => {
    expect(validarMaximoDePrestamosActivos(valor)).toEqual({ ok: true, value: valor });
  });

  it.each([0, 1.5, -2, 'dos'])('rejects %s', (valor) => {
    const r = validarMaximoDePrestamosActivos(valor);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.mensaje).toBe('El máximo de préstamos activos debe ser un número entero de al menos 1.');
  });
});
