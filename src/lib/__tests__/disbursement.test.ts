import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { buildDisbursementReceipt, disburseLoan } from '@/lib/disbursement';

const base = {
  loanId: 'loan-1',
  loanSharesAmount: 100_000,
  loanSharesCount: 2,
  loanSharesPaidUpfront: false,
  deductions: [],
  unitValue: 50_000,
  disbursedAt: new Date('2026-11-20T15:00:00Z'),
};

describe('buildDisbursementReceipt (RN-4.14, RN-4.17)', () => {
  it('RN-4.14: shares discounted from the disbursement become one acciones_prestamo item', () => {
    const r = buildDisbursementReceipt(base);
    expect(r.items).toEqual([
      {
        concept: 'acciones_prestamo',
        target_month: '2026-11-01',
        share_count: 2,
        unit_value: 50_000,
        amount: 100_000,
        loan_id: 'loan-1',
        auto_generated: false,
      },
    ]);
  });

  it('uses the month in Bogota, not the server month', () => {
    // 2026-11-01 03:00 UTC is still 31 October in Bogota.
    const r = buildDisbursementReceipt({ ...base, disbursedAt: new Date('2026-11-01T03:00:00Z') });
    expect(r.items[0].target_month).toBe('2026-10-01');
    expect(r.interestPaidMonth).toBe('2026-10-01');
  });

  it('RN-4.14: shares paid upfront are not charged again', () => {
    const r = buildDisbursementReceipt({ ...base, loanSharesPaidUpfront: true });
    expect(r.items).toEqual([]);
  });

  it('keeps the share count and unit value empty when the count is unknown', () => {
    const r = buildDisbursementReceipt({ ...base, loanSharesCount: null });
    expect(r.items[0]).toMatchObject({ share_count: null, unit_value: null, amount: 100_000 });
  });

  it('adds the stored deductions after the loan shares, with fines marked as automatic', () => {
    const r = buildDisbursementReceipt({
      ...base,
      deductions: [
        { concept: 'multa_acciones', target_month: '2026-09-01', amount: 15_000 },
        { concept: 'pago_intereses', target_month: '2026-10-01', amount: 20_000, loan_id: 'loan-0' },
      ],
    });
    expect(r.items.map((i) => [i.concept, i.amount, i.loan_id, i.auto_generated])).toEqual([
      ['acciones_prestamo', 100_000, 'loan-1', false],
      ['multa_acciones', 15_000, null, true],
      ['pago_intereses', 20_000, 'loan-0', false],
    ]);
  });

  it('returns no items when nothing is deducted', () => {
    const r = buildDisbursementReceipt({ ...base, loanSharesAmount: 0 });
    expect(r.items).toEqual([]);
  });
});

function fakeClient(result: { data?: unknown; error: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc } as unknown as SupabaseClient<Database>, rpc };
}

const request = {
  loanId: 'loan-1',
  actorId: 'actor-1',
  disbursement: {
    disbursed_amount: 896_400,
    four_per_thousand: 3_600,
    disbursed_at: '2026-11-20T15:00:00.000Z',
    full_rate_day_limit: 15,
    cutoff_day: 25,
    disbursement_proof_path: 'proofs/ce.png',
    payment_method: 'transfer' as const,
    applied_month: '2026-11-01',
    interest_paid_month: '2026-11-01',
  },
  plan: [],
  receiptItems: [],
};

describe('disburseLoan (RN-4.17)', () => {
  it('RN-4.17: sends the whole disbursement in one call and returns the CE number', async () => {
    const { client, rpc } = fakeClient({ data: 'CE-00007', error: null });
    const r = await disburseLoan(client, request);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('desembolsar_prestamo', {
      p_loan_id: 'loan-1',
      p_actor: 'actor-1',
      p_disbursement: request.disbursement,
      p_plan: [],
      p_receipt_items: [],
    });
    expect(r).toEqual({ ok: true, ceNumber: 'CE-00007' });
  });

  it.each([
    ['audit_status_conflict', 409, 'stale_status'],
    ['upfront_shares_unpaid', 422, 'upfront_shares_unpaid'],
    ['insufficient_cash_balance', 422, 'insufficient_cash_balance'],
  ])('maps the database error %s to %i', async (message, status, code) => {
    const { client } = fakeClient({ error: { message } });
    const r = await disburseLoan(client, request);
    expect(r).toMatchObject({ ok: false, status, code });
  });

  it('reports any other failure as a 500', async () => {
    const { client } = fakeClient({ error: { message: 'boom' } });
    const r = await disburseLoan(client, request);
    expect(r).toMatchObject({ ok: false, status: 500, code: 'unexpected' });
  });
});
