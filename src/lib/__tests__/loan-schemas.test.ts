import { describe, it, expect } from 'vitest';
import { createLoanSchema, updatePaymentPlanSchema } from '@/lib/schemas/loan';

// RN-4.3 (section 11, n.º 5): the term is no longer chosen; it runs until
// December. A months field is rejected instead of silently ignored.
const MENSAJE_PLAZO = 'El plazo ya no se elige: va hasta diciembre del periodo (RN-4.3).';

describe('createLoanSchema (RN-4.3)', () => {
  it('accepts a request without months', () => {
    const r = createLoanSchema.safeParse({ requested_amount: 1_000_000 });
    expect(r.success).toBe(true);
  });

  it('rejects a request that still sends payment_plan_months', () => {
    const r = createLoanSchema.safeParse({ requested_amount: 1_000_000, payment_plan_months: 12 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]).toMatchObject({ path: ['payment_plan_months'], message: MENSAJE_PLAZO });
  });

  it('still rejects an amount below 500.000', () => {
    expect(createLoanSchema.safeParse({ requested_amount: 400_000 }).success).toBe(false);
  });
});

describe('updatePaymentPlanSchema (RN-4.3, RN-4.26)', () => {
  it('accepts the edited capital without months', () => {
    const r = updatePaymentPlanSchema.safeParse({ capital_overrides: { '5': 200_000 } });
    expect(r.success).toBe(true);
  });

  it('rejects a request that still sends months', () => {
    const r = updatePaymentPlanSchema.safeParse({ months: 12, capital_overrides: {} });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]).toMatchObject({ path: ['months'], message: MENSAJE_PLAZO });
  });

  it('still rejects a negative edited capital', () => {
    expect(updatePaymentPlanSchema.safeParse({ capital_overrides: { '1': -1 } }).success).toBe(false);
  });
});
