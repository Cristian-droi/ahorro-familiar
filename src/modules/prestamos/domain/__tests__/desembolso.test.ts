import { describe, it, expect } from 'vitest';
import { calcularDesembolso, type Deducciones } from '@/modules/prestamos/domain/desembolso';

// Default rate from docs/reglas-negocio.md, section 10: 0,004 = 4 per thousand.
const TASA_POR_MIL = 4;

const SIN_DEDUCCIONES: Deducciones = { acciones: 0, multas: 0, intereses: 0, capital: 0 };

describe('calcularDesembolso (RN-4.16)', () => {
  it('matches the rule example: 1.000.000 with 100.000 of shares deducted → transfers 896.400', () => {
    const r = calcularDesembolso({
      monto: 1000000,
      deducciones: { ...SIN_DEDUCCIONES, acciones: 100000 },
      tasaPorMil: TASA_POR_MIL,
    });
    expect(r).toEqual({
      ok: true,
      value: { totalDeducciones: 100000, netoAntesDeImpuesto: 900000, cuatroPorMil: 3600, seTransfiere: 896400 },
    });
  });

  it('taxes the net after every deduction, never the gross amount', () => {
    const r = calcularDesembolso({
      monto: 2000000,
      deducciones: { acciones: 200000, multas: 15000, intereses: 40000, capital: 245000 },
      tasaPorMil: TASA_POR_MIL,
    });
    expect(r).toEqual({
      ok: true,
      value: { totalDeducciones: 500000, netoAntesDeImpuesto: 1500000, cuatroPorMil: 6000, seTransfiere: 1494000 },
    });
  });

  it('taxes the full amount when nothing is deducted (shares paid in advance)', () => {
    const r = calcularDesembolso({ monto: 900000, deducciones: SIN_DEDUCCIONES, tasaPorMil: TASA_POR_MIL });
    expect(r.ok && r.value.cuatroPorMil).toBe(3600);
    expect(r.ok && r.value.seTransfiere).toBe(896400);
  });

  it.each([
    [375, 2],
    [125, 1],
    [124, 0],
  ])('rounds the tax with Math.round: net %i → %i', (monto, esperado) => {
    const r = calcularDesembolso({ monto, deducciones: SIN_DEDUCCIONES, tasaPorMil: TASA_POR_MIL });
    expect(r.ok && r.value.cuatroPorMil).toBe(esperado);
  });

  it('transfers nothing and pays no tax when deductions equal the amount', () => {
    const r = calcularDesembolso({
      monto: 500000,
      deducciones: { ...SIN_DEDUCCIONES, capital: 500000 },
      tasaPorMil: TASA_POR_MIL,
    });
    expect(r.ok && r.value).toEqual({ totalDeducciones: 500000, netoAntesDeImpuesto: 0, cuatroPorMil: 0, seTransfiere: 0 });
  });

  it('rejects deductions larger than the amount', () => {
    const r = calcularDesembolso({
      monto: 500000,
      deducciones: { ...SIN_DEDUCCIONES, capital: 400000, intereses: 100001 },
      tasaPorMil: TASA_POR_MIL,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.codigo).toBe('deducciones_mayores_al_monto');
      expect(r.error.mensaje).toBe('Las deducciones (500.001) superan el monto del préstamo (500.000).');
    }
  });

  it.each([
    ['a negative deduction', 1000000, { ...SIN_DEDUCCIONES, multas: -1 }],
    ['a fractional deduction', 1000000, { ...SIN_DEDUCCIONES, intereses: 0.5 }],
    ['a zero amount', 0, SIN_DEDUCCIONES],
    ['a fractional amount', 1000000.5, SIN_DEDUCCIONES],
  ])('rejects %s', (_caso, monto, deducciones) => {
    const r = calcularDesembolso({ monto, deducciones, tasaPorMil: TASA_POR_MIL });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.codigo).toBe('valor_invalido');
  });
});
