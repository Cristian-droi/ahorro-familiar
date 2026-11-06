import { describe, it, expect } from 'vitest';
import { createLoanSchema, updatePaymentPlanSchema } from '@/lib/schemas/loan';

// RN-4.3: the shareholder chooses the term. The schema only checks the shape
// (a whole number of months); the maximum is validated by the domain plan.

describe('createLoanSchema (RN-4.3)', () => {
  it('accepts the chosen term in months', () => {
    const r = createLoanSchema.safeParse({ requested_amount: 1_000_000, payment_plan_months: 4 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.payment_plan_months).toBe(4);
  });

  it('accepts a request without months (the maximum term applies)', () => {
    const r = createLoanSchema.safeParse({ requested_amount: 1_000_000 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.payment_plan_months).toBeUndefined();
  });

  it('leaves the maximum to the domain: 13 months passes the schema', () => {
    expect(createLoanSchema.safeParse({ requested_amount: 1_000_000, payment_plan_months: 13 }).success).toBe(true);
  });

  it.each([0, -1, 2.5])('rejects %s months', (meses) => {
    expect(createLoanSchema.safeParse({ requested_amount: 1_000_000, payment_plan_months: meses }).success).toBe(false);
  });

  it('still rejects an amount below 500.000', () => {
    expect(createLoanSchema.safeParse({ requested_amount: 400_000 }).success).toBe(false);
  });
});

describe('updatePaymentPlanSchema (RN-4.3, RN-4.3b, RN-4.26)', () => {
  it('accepts the chosen term with the edited capital', () => {
    const r = updatePaymentPlanSchema.safeParse({ months: 4, capital_overrides: { '4': 1_000_000 } });
    expect(r.success).toBe(true);
  });

  it('accepts the edited capital without months', () => {
    expect(updatePaymentPlanSchema.safeParse({ capital_overrides: { '5': 200_000 } }).success).toBe(true);
  });

  it('accepts capital keyed by calendar month', () => {
    expect(updatePaymentPlanSchema.safeParse({ capital_overrides: { '2026-06-01': 1_000_000 } }).success).toBe(true);
  });

  it('rejects zero months', () => {
    expect(updatePaymentPlanSchema.safeParse({ months: 0, capital_overrides: {} }).success).toBe(false);
  });

  it('still rejects a negative edited capital', () => {
    expect(updatePaymentPlanSchema.safeParse({ capital_overrides: { '1': -1 } }).success).toBe(false);
  });
});
