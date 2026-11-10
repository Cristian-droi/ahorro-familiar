import { describe, it, expect } from 'vitest';
import { ritmoDePago, ritmoDelAccionista } from '@/modules/prestamos/domain/ritmo-de-pago';
import type { FechaISO } from '@/shared/domain/fechas';

const f = (texto: string) => texto as FechaISO;

const plan = [
  { mes: f('2026-10-01'), capital: 300_000 },
  { mes: f('2026-11-01'), capital: 300_000 },
  { mes: f('2026-12-01'), capital: 400_000 },
];

describe('ritmoDePago (section 4.7, RN-4.30)', () => {
  it('section 4.7: in October with 900.000 left and 3 months to go, the installment to close the year is 300.000', () => {
    const r = ritmoDePago({ saldo: 900_000, mesActual: f('2026-10-01'), mesAplicado: f('2026-10-01'), plan });
    expect(r).toEqual({ saldo: 900_000, cuotaPactadaDelMes: 300_000, cuotaParaCerrar: 300_000, mesFinal: '2026-12-01' });
  });

  it('RN-4.30: 1.000.000 over 3 months rounds up to 333.334', () => {
    expect(ritmoDePago({ saldo: 1_000_000, mesActual: f('2026-10-01'), mesAplicado: f('2026-10-01'), plan }).cuotaParaCerrar).toBe(333_334);
  });

  it('the agreed installment is the one planned for the current month', () => {
    expect(ritmoDePago({ saldo: 700_000, mesActual: f('2026-12-01'), mesAplicado: f('2026-10-01'), plan }).cuotaPactadaDelMes).toBe(400_000);
  });

  it('a month without a planned installment has none', () => {
    expect(ritmoDePago({ saldo: 700_000, mesActual: f('2026-09-01'), mesAplicado: f('2026-09-01'), plan }).cuotaPactadaDelMes).toBe(0);
  });

  it('after the last month of the term the whole balance is due now', () => {
    expect(ritmoDePago({ saldo: 250_000, mesActual: f('2027-01-01'), mesAplicado: f('2026-10-01'), plan }).cuotaParaCerrar).toBe(250_000);
  });

  it('RN-4.15: a loan that starts next month has nothing to close yet', () => {
    expect(ritmoDePago({ saldo: 900_000, mesActual: f('2026-09-01'), mesAplicado: f('2026-10-01'), plan }).cuotaParaCerrar).toBe(0);
  });
});

describe('ritmoDelAccionista (section 4.7)', () => {
  it('section 4.7: adds what is left to pay across every active loan of the shareholder', () => {
    const r = ritmoDelAccionista([
      { saldo: 900_000, cuotaPactadaDelMes: 300_000, cuotaParaCerrar: 300_000, mesFinal: f('2026-12-01') },
      { saldo: 1_000_000, cuotaPactadaDelMes: 200_000, cuotaParaCerrar: 333_334, mesFinal: f('2026-12-01') },
    ]);
    expect(r).toEqual({ saldo: 1_900_000, cuotaPactadaDelMes: 500_000, cuotaParaCerrar: 633_334 });
  });
});
