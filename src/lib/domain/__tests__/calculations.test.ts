import { describe, it, expect } from 'vitest';
import {
  buildPaymentPlan,
  calcAccruedInterest,
} from '@/lib/loans';

describe('Financial Calculations', () => {
  describe('buildPaymentPlan', () => {
    it('builds a standard payment plan without overrides', () => {
      // Use noon to avoid timezone shift causing day to be previous month's end
      const disbursedAt = new Date('2026-05-10T12:00:00Z');
      const plan = buildPaymentPlan({
        requestedAmount: 1_000_000,
        months: 10,
        rate: 0.02,
        disbursedAt,
      });

      expect(plan.length).toBe(10);
      expect(plan[0].capital_amount).toBe(100_000);
      expect(plan[0].estimated_interest).toBe(20_000); // 2% of 1M
      expect(plan[0].estimated_balance_after).toBe(900_000);
      
      expect(plan[9].capital_amount).toBe(100_000);
      expect(plan[9].estimated_balance_after).toBe(0);
    });

    it('handles capital overrides correctly', () => {
      const disbursedAt = new Date('2026-05-10T12:00:00Z');
      const plan = buildPaymentPlan({
        requestedAmount: 1_000_000,
        months: 10,
        rate: 0.02,
        disbursedAt,
        capitalOverrides: { 5: 200_000 },
      });

      expect(plan[4].capital_amount).toBe(200_000); // 5th month (index 4)
      // 100k for 1..4 (400k), 200k for 5 (200k). Total consumed: 600k. Remaining: 400k for 5 months.
      expect(plan[5].capital_amount).toBe(80_000); // 6th month (index 5)
    });
    
    it('adjusts first month interest if disbursed after day 15', () => {
      const disbursedAt = new Date('2026-05-20T12:00:00Z');
      const plan = buildPaymentPlan({
        requestedAmount: 1_000_000,
        months: 10,
        rate: 0.02,
        disbursedAt,
      });
      // Rate is halved for first month
      expect(plan[0].estimated_interest).toBe(10_000); // 1% of 1M
      // Second month normal
      expect(plan[1].estimated_interest).toBe(18_000); // 2% of 900k
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
