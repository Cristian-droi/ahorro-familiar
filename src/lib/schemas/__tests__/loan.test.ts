import { describe, it, expect } from 'vitest';
import { deductionsDetailSchema } from '@/lib/schemas/loan';

const validItem = {
  concept: 'acciones',
  target_month: '2026-08',
  share_count: 2,
  unit_value: 10_000,
  amount: 20_000,
};

describe('deductionsDetailSchema', () => {
  it('accepts an empty array', () => {
    expect(deductionsDetailSchema.parse([])).toEqual([]);
  });

  it('accepts every known concept', () => {
    const items = ['acciones', 'multa_acciones', 'pago_intereses', 'pago_capital'].map((concept) => ({
      ...validItem,
      concept,
    }));
    expect(deductionsDetailSchema.parse(items)).toHaveLength(4);
  });

  it('accepts null and missing optional fields', () => {
    const item = {
      concept: 'pago_capital',
      target_month: '2026-08',
      amount: 150_000,
      share_count: null,
      loan_id: null,
    };
    expect(deductionsDetailSchema.parse([item])).toEqual([item]);
  });

  it('rejects an unknown concept', () => {
    expect(deductionsDetailSchema.safeParse([{ ...validItem, concept: 'otro' }]).success).toBe(false);
  });

  it('rejects a missing amount', () => {
    const { amount: _amount, ...withoutAmount } = validItem;
    expect(deductionsDetailSchema.safeParse([withoutAmount]).success).toBe(false);
  });

  it('rejects an amount stored as a string', () => {
    expect(deductionsDetailSchema.safeParse([{ ...validItem, amount: '20000' }]).success).toBe(false);
  });

  it('rejects a non-array value', () => {
    expect(deductionsDetailSchema.safeParse(validItem).success).toBe(false);
  });
});
