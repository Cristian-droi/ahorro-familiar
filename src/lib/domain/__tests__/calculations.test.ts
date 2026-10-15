import { describe, it, expect } from 'vitest';
import {
  calcLoanShares,
  calcFourPerThousand,
  calcDisbursedAmount,
  calcLoanDeductionsAndNet,
  buildPaymentPlan,
  calcAccruedInterest,
} from '@/lib/loans';

describe('Financial Calculations', () => {
  describe('calcLoanShares', () => {
    it('calculates shares based on step of 500,000', () => {
      const result = calcLoanShares(1_200_000, 10_000);
      expect(result.count).toBe(2); // 1,200,000 / 500,000 = 2.4 => 2
      expect(result.amount).toBe(20_000);
    });

    it('returns 0 for amounts less than 500,000', () => {
      const result = calcLoanShares(499_999, 10_000);
      expect(result.count).toBe(0);
      expect(result.amount).toBe(0);
    });
  });

  describe('calcFourPerThousand', () => {
    it('calculates 4x1000 correctly', () => {
      expect(calcFourPerThousand(1_000_000)).toBe(4_000);
      expect(calcFourPerThousand(500_000)).toBe(2_000);
    });
  });

  describe('calcDisbursedAmount', () => {
    it('deducts shares amount and 4x1000 when paid upfront is false', () => {
      const disbursed = calcDisbursedAmount(1_000_000, 20_000, false, 4_000);
      expect(disbursed).toBe(976_000); // 1,000,000 - 20,000 - 4,000
    });

    it('only deducts 4x1000 when paid upfront is true', () => {
      const disbursed = calcDisbursedAmount(1_000_000, 20_000, true, 4_000);
      expect(disbursed).toBe(996_000); // 1,000,000 - 4,000
    });
  });

  describe('calcLoanDeductionsAndNet', () => {
    it('calculates net and 4x1000 correctly when paid upfront is false and net > 0', () => {
      const result = calcLoanDeductionsAndNet({
        requestedAmount: 2_000_000,
        sharesAmount: 40_000,
        paidUpfront: false,
        deductedShares: 50_000,
        deductedFines: 10_000,
        deductedInterest: 30_000,
        deductedCapital: 500_000,
      });
      // netBeforeTax = 2,000,000 - 40,000 (shares) - 50,000 - 10,000 - 30,000 - 500,000 = 1,370,000
      // 4x1000 = 1,370,000 * 0.004 = 5,480
      // netDisbursed = 1,370,000 - 5,480 = 1,364,520
      expect(result.fourPerThousand).toBe(5_480);
      expect(result.netDisbursed).toBe(1_364_520);
    });

    it('calculates net and 4x1000 correctly when paid upfront is true and net > 0', () => {
      const result = calcLoanDeductionsAndNet({
        requestedAmount: 2_000_000,
        sharesAmount: 40_000,
        paidUpfront: true,
        deductedShares: 50_000,
        deductedFines: 10_000,
        deductedInterest: 30_000,
        deductedCapital: 500_000,
      });
      // netBeforeTax = 2,000,000 - 0 (upfront) - 50,000 - 10,000 - 30,000 - 500,000 = 1,410,000
      // 4x1000 = 1,410,000 * 0.004 = 5,640
      // netDisbursed = 1,410,000 - 5,640 = 1,404,360
      expect(result.fourPerThousand).toBe(5_640);
      expect(result.netDisbursed).toBe(1_404_360);
    });

    it('returns 0 for both 4x1000 and net disbursed when net before tax is 0', () => {
      const result = calcLoanDeductionsAndNet({
        requestedAmount: 1_000_000,
        sharesAmount: 20_000,
        paidUpfront: false,
        deductedShares: 50_000,
        deductedFines: 30_000,
        deductedInterest: 100_000,
        deductedCapital: 800_000,
      });
      // netBeforeTax = 1,000,000 - 20,000 - 50,000 - 30,000 - 100,000 - 800,000 = 0
      expect(result.fourPerThousand).toBe(0);
      expect(result.netDisbursed).toBe(0);
    });

    it('returns 0 for both 4x1000 and net disbursed when net before tax is negative', () => {
      const result = calcLoanDeductionsAndNet({
        requestedAmount: 1_000_000,
        sharesAmount: 20_000,
        paidUpfront: false,
        deductedShares: 50_000,
        deductedFines: 30_000,
        deductedInterest: 100_000,
        deductedCapital: 900_000,
      });
      // netBeforeTax = 1,000,000 - 20,000 - 50,000 - 30,000 - 100,000 - 900,000 = -100,000 => <= 0
      expect(result.fourPerThousand).toBe(0);
      expect(result.netDisbursed).toBe(0);
    });
  });

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
