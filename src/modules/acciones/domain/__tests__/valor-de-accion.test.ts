import { describe, it, expect } from 'vitest';
import { elegirValorDeAccion, validarPuedeComprar } from '@/modules/acciones/domain/valor-de-accion';

const permitidos = [10000, 25000, 50000];
const base = { estadoDelPeriodo: 'open' as const, cambioHabilitado: false, tieneCompras: false, permitidos };

describe('elegirValorDeAccion (RN-2.1, RN-2.2)', () => {
  it('accepts an allowed value when none was chosen for the open period', () => {
    const r = elegirValorDeAccion({ ...base, valorActual: null, valor: 25000 });
    expect(r).toEqual({ ok: true, value: 25000 });
  });

  it('rejects a value outside the allowed ones (RN-2.1)', () => {
    const r = elegirValorDeAccion({ ...base, valorActual: null, valor: 20000 });
    expect(r).toEqual({
      ok: false,
      error: {
        codigo: 'valor_no_permitido',
        mensaje: 'El valor de la acción debe ser uno de los permitidos: 10.000, 25.000 o 50.000.',
      },
    });
  });

  it('needs the administrator permission to change a chosen value (RN-2.2)', () => {
    const r = elegirValorDeAccion({ ...base, valorActual: 25000, valor: 50000 });
    expect(r).toEqual({
      ok: false,
      error: {
        codigo: 'valor_ya_elegido',
        mensaje: 'Ya elegiste el valor de tu acción para este periodo. Para cambiarlo, pídele al administrador que lo habilite.',
      },
    });
  });

  it('changes a chosen value when the administrator allowed it and there are no purchases', () => {
    const r = elegirValorDeAccion({ ...base, cambioHabilitado: true, valorActual: 25000, valor: 50000 });
    expect(r).toEqual({ ok: true, value: 50000 });
  });

  it('never changes the value after the first share receipt, even with permission', () => {
    const r = elegirValorDeAccion({
      ...base,
      cambioHabilitado: true,
      tieneCompras: true,
      valorActual: 25000,
      valor: 50000,
    });
    expect(r).toEqual({
      ok: false,
      error: {
        codigo: 'valor_bloqueado_por_compra',
        mensaje: 'Ya compraste acciones con este valor. Podrás cambiarlo en el próximo periodo.',
      },
    });
  });

  it.each(['closing', 'closed'] as const)('assumption: rejects a choice when the period is %s', (estadoDelPeriodo) => {
    const r = elegirValorDeAccion({ ...base, estadoDelPeriodo, valorActual: null, valor: 25000 });
    expect(!r.ok && r.error.codigo).toBe('periodo_no_abierto');
  });
});

describe('validarPuedeComprar (RN-2.3)', () => {
  it('blocks a purchase while the period share value is not chosen', () => {
    expect(validarPuedeComprar({ valorDeAccion: null })).toEqual({
      ok: false,
      error: {
        codigo: 'sin_valor_de_accion',
        mensaje: 'Primero elige el valor de tu acción para este periodo.',
      },
    });
  });

  it('returns the period share value when it is chosen', () => {
    expect(validarPuedeComprar({ valorDeAccion: 25000 })).toEqual({ ok: true, value: 25000 });
  });
});
