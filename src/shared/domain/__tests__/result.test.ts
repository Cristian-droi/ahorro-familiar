import { describe, it, expect } from 'vitest';
import { ok, err, type Result, type ErrorDeDominio } from '@/shared/domain/result';

describe('Result', () => {
  it('ok wraps a value', () => {
    const r: Result<number, ErrorDeDominio> = ok(20000);
    expect(r).toEqual({ ok: true, value: 20000 });
  });

  it('err wraps a domain error with code and message', () => {
    const r: Result<number, ErrorDeDominio> = err({
      codigo: 'intereses_pendientes',
      mensaje: 'Primero debes pagar los intereses de este préstamo (20.000)',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.codigo).toBe('intereses_pendientes');
    }
  });

  it('narrows the type on the ok flag', () => {
    const r: Result<string, ErrorDeDominio> = ok('2026-10-19');
    const valor = r.ok ? r.value : null;
    expect(valor).toBe('2026-10-19');
  });
});
