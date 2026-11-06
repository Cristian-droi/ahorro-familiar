import { describe, it, expect, vi, afterEach } from 'vitest';
import { crearFecha, type FechaISO } from '@/shared/domain/fechas';
import { calcAccruedInterest, type LoanInterestItem } from '@/lib/loans';

function fecha(texto: string): FechaISO {
  const r = crearFecha(texto);
  if (!r.ok) throw new Error(`Invalid test date: ${texto}`);
  return r.value;
}

const base = { requestedAmount: 1_000_000, rate: 0.02, items: [] as LoanInterestItem[] };

describe('calcAccruedInterest (adapter over interesesAdeudados)', () => {
  afterEach(() => vi.useRealTimers());

  it('RN-4.20: reads the disbursement day in Bogota, not in UTC (20 March at 21:00 Bogota is 21 March UTC)', () => {
    const r = calcAccruedInterest({ ...base, disbursedAt: '2026-03-21T02:00:00+00:00', today: fecha('2026-04-05') });
    // 20 March in Bogota: half rate in March.
    expect(r).toEqual({ ok: true, value: 10_000 });
  });

  it('RN-4.21: a disbursement on 28 March owes 0 for March and 20.000 for April', () => {
    expect(calcAccruedInterest({ ...base, disbursedAt: '2026-03-28', today: fecha('2026-04-15') })).toEqual({ ok: true, value: 0 });
    expect(calcAccruedInterest({ ...base, disbursedAt: '2026-03-28', today: fecha('2026-05-01') })).toEqual({ ok: true, value: 20_000 });
  });

  it('RN-4.18 and RN-4.25: capital payments lower the next months and interest payments are subtracted', () => {
    const items: LoanInterestItem[] = [
      { concept: 'pago_capital', target_month: '2026-01-01', amount: '500000' },
      { concept: 'pago_intereses', target_month: '2026-02-01', amount: 15_000 },
      { concept: 'acciones', target_month: '2026-02-01', amount: 50_000 },
    ];
    const r = calcAccruedInterest({ ...base, disbursedAt: '2026-01-10', items, today: fecha('2026-04-10') });
    // 20.000 + 10.000 + 10.000 accrued, minus 15.000 paid.
    expect(r).toEqual({ ok: true, value: 25_000 });
  });

  it('uses the Bogota date of the clock when no day is given', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T03:00:00Z')); // still 31 March in Bogota
    expect(calcAccruedInterest({ ...base, disbursedAt: '2026-03-10' })).toEqual({ ok: true, value: 0 });
  });

  it('reports a loan without a valid stored rate instead of using 2%', () => {
    const r = calcAccruedInterest({ ...base, rate: null, disbursedAt: '2026-03-10', today: fecha('2026-05-01') });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.codigo).toBe('tasa_invalida');
  });

  it('reports an invalid disbursement date', () => {
    const r = calcAccruedInterest({ ...base, disbursedAt: 'no es fecha', today: fecha('2026-05-01') });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.codigo).toBe('fecha_invalida');
  });
});
