import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { validateCapitalPayments } from '@/lib/receipt-capital';

type PendingRow = { loan_id: string; amount: number; receipt_id: string };

function fakeClient(options: {
  loans: { id: string; loan_number: number; outstanding_balance: number }[];
  pending?: PendingRow[];
  loansError?: { message: string };
}) {
  const from = (table: string) => {
    const builder = {
      select: () => builder,
      in: () => builder,
      eq: () => builder,
      then: (resolve: (value: unknown) => void) =>
        resolve(
          table === 'loans'
            ? { data: options.loansError ? null : options.loans, error: options.loansError ?? null }
            : { data: options.pending ?? [], error: null },
        ),
    };
    return builder;
  };
  return { from } as unknown as SupabaseClient<Database>;
}

const loan = { id: 'loan-1', loan_number: 7, outstanding_balance: 1000000 };
const capital = (amount: number, loan_id = 'loan-1') => ({ concept: 'pago_capital', loan_id, amount });

describe('validateCapitalPayments (RN-4.29)', () => {
  it('ignores a receipt without capital payments', async () => {
    const r = await validateCapitalPayments(fakeClient({ loans: [] }), {
      items: [{ concept: 'acciones', loan_id: null, amount: 50000 }],
      countPending: true,
    });
    expect(r.ok).toBe(true);
  });

  it('RN-4.29: rejects a payment above the balance and names the loan and the maximum', async () => {
    const r = await validateCapitalPayments(fakeClient({ loans: [loan] }), {
      items: [capital(1000001)],
      countPending: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.codigo).toBe('abono_mayor_al_saldo');
    expect(r.error.mensaje).toContain('#7');
    expect(r.error.mensaje).toContain('$1.000.000');
  });

  it('RN-4.29: adds the lines of the same loan', async () => {
    const r = await validateCapitalPayments(fakeClient({ loans: [loan] }), {
      items: [capital(600000), capital(400001)],
      countPending: true,
    });
    expect(r.ok).toBe(false);
  });

  it('RN-4.29: counts other pending receipts when creating', async () => {
    const pending = [{ loan_id: 'loan-1', amount: 700000, receipt_id: 'other' }];
    const r = await validateCapitalPayments(fakeClient({ loans: [loan], pending }), {
      items: [capital(300001)],
      countPending: true,
    });
    expect(r.ok).toBe(false);
  });

  it('RN-4.29: a resubmitted receipt does not count against itself', async () => {
    const pending = [{ loan_id: 'loan-1', amount: 700000, receipt_id: 'this-one' }];
    const r = await validateCapitalPayments(fakeClient({ loans: [loan], pending }), {
      items: [capital(1000000)],
      countPending: true,
      excludeReceiptId: 'this-one',
    });
    expect(r.ok).toBe(true);
  });

  it('RN-4.29: approval compares only against the current balance', async () => {
    const pending = [{ loan_id: 'loan-1', amount: 700000, receipt_id: 'other' }];
    const r = await validateCapitalPayments(fakeClient({ loans: [loan], pending }), {
      items: [capital(1000000)],
      countPending: false,
    });
    expect(r.ok).toBe(true);
  });

  it('keeps each loan independent (RN-4.27)', async () => {
    const other = { id: 'loan-2', loan_number: 8, outstanding_balance: 50000 };
    const r = await validateCapitalPayments(fakeClient({ loans: [loan, other] }), {
      items: [capital(1000000), capital(50001, 'loan-2')],
      countPending: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.mensaje).toContain('#8');
  });

  it('throws when the balance cannot be read', async () => {
    await expect(
      validateCapitalPayments(fakeClient({ loans: [], loansError: { message: 'boom' } }), {
        items: [capital(1)],
        countPending: true,
      }),
    ).rejects.toEqual({ message: 'boom' });
  });
});
