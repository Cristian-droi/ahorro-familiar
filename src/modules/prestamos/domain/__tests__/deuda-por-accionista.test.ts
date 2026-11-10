import { describe, it, expect } from 'vitest';
import { deudaPorAccionista } from '@/modules/prestamos/domain/deuda-por-accionista';

describe('deudaPorAccionista (RN-4.22, RN-4.27)', () => {
  it('RN-4.27: adds the capital and the interest owed of each loan of the same shareholder', () => {
    const r = deudaPorAccionista([
      { accionistaId: 'ana', saldoCapital: 600_000, interesAdeudado: 22_000 },
      { accionistaId: 'luis', saldoCapital: 500_000, interesAdeudado: 30_000 },
      { accionistaId: 'ana', saldoCapital: 100_000, interesAdeudado: 2_000 },
    ]);
    expect(r).toEqual(
      new Map([
        ['ana', { saldoCapital: 700_000, interesAdeudado: 24_000 }],
        ['luis', { saldoCapital: 500_000, interesAdeudado: 30_000 }],
      ]),
    );
  });

  it('without loans nobody owes', () => {
    expect(deudaPorAccionista([]).size).toBe(0);
  });
});
