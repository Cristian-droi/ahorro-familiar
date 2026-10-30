import { describe, it, expect } from 'vitest';
import {
  buildPaymentPlan,
  calcAccruedInterest,
} from '@/lib/loans';
import { crearFecha, type FechaISO } from '@/shared/domain/fechas';

describe('Financial Calculations', () => {
  describe('buildPaymentPlan (adapter over planDePagos)', () => {
    const fecha = (texto: string): FechaISO => {
      const r = crearFecha(texto);
      if (!r.ok) throw new Error(`Invalid test date: ${texto}`);
      return r.value;
    };
    const rows = (r: ReturnType<typeof buildPaymentPlan>) => {
      if (!r.ok) throw new Error(r.error.mensaje);
      return r.value;
    };

    it('builds the plan until December with the stored fractional rate (RN-4.3, RN-4.18)', () => {
      const plan = rows(buildPaymentPlan({ requestedAmount: 1_000_000, rate: 0.02, disbursedOn: fecha('2026-03-10') }));

      expect(plan).toHaveLength(10);
      expect(plan[0]).toEqual({
        month_number: 1,
        due_date: '2026-03-01',
        capital_amount: 100_000,
        estimated_interest: 20_000,
        estimated_balance_after: 900_000,
      });
      expect(plan[9]).toMatchObject({ due_date: '2026-12-01', capital_amount: 100_000, estimated_balance_after: 0 });
    });

    it('handles capital overrides', () => {
      const plan = rows(
        buildPaymentPlan({
          requestedAmount: 1_000_000,
          rate: 0.02,
          disbursedOn: fecha('2026-03-10'),
          capitalOverrides: { 5: 200_000 },
        }),
      );
      expect(plan[4].capital_amount).toBe(200_000);
      expect(plan[5].capital_amount).toBe(80_000);
    });

    it('charges half rate in the first month after day 15 (RN-4.20)', () => {
      const plan = rows(buildPaymentPlan({ requestedAmount: 1_000_000, rate: 0.02, disbursedOn: fecha('2026-05-20') }));
      expect(plan[0].estimated_interest).toBe(10_000);
      expect(plan[1].estimated_interest).toBe(17_500); // 8 months from May: 2% of 875.000
    });

    it('moves a disbursement after day 25 to the next month (RN-4.15, RN-4.21)', () => {
      const plan = rows(buildPaymentPlan({ requestedAmount: 1_000_000, rate: 0.02, disbursedOn: fecha('2026-03-28') }));
      expect(plan[0]).toMatchObject({ month_number: 1, due_date: '2026-04-01', estimated_interest: 20_000 });
      expect(plan).toHaveLength(9);
    });

    it('returns the domain error for an invalid override', () => {
      const r = buildPaymentPlan({
        requestedAmount: 1_000_000,
        rate: 0.02,
        disbursedOn: fecha('2026-03-10'),
        capitalOverrides: { 2: -5 },
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.codigo).toBe('capital_invalido');
    });
  });

  describe('calcAccruedInterest', () => {
    it('calculates interest correctly for multiple months overdue', async () => {
      const disbursedAt = new Date('2026-01-10T12:00:00Z');
      const mockNow = new Date('2026-04-10T12:00:00Z'); // 3 months later
      
      const { vi } = await import('vitest');
      vi.useFakeTimers();
      vi.setSystemTime(mockNow);
      
      const interest = calcAccruedInterest({
        outstandingBalance: 1_000_000,
        rate: 0.02,
        disbursedAt,
        lastInterestPaymentDate: null,
      });

      // 3 months at 2% = 6% of 1M = 60_000
      expect(interest).toBe(60_000);
      vi.useRealTimers();
    });
  });
});
