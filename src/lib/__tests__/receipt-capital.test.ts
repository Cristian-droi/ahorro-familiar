import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { validateCapitalPayments } from '@/lib/receipt-capital';

type LoanRow = { id: string; user_id?: string; loan_number: number; outstanding_balance: number };
type PendingRow = { loan_id: string; amount: number; receipt_id: string; concept?: string; status?: string };

// Applies the .eq() filters, so removing one from the code fails a test.
function fakeClient(options: {
  loans: LoanRow[];
  pending?: PendingRow[];
  loansError?: { message: string };
}) {
  const from = (table: string) => {
    const filters: [string, unknown][] = [];
    const builder = {
      select: () => builder,
      in: () => builder,
      eq: (column: string, value: unknown) => {
        filters.push([column.replace('receipts.', ''), value]);
        return builder;
      },
      then: (resolve: (value: unknown) => void) => {
        const rows: Record<string, unknown>[] =
          table === 'loans'
            ? options.loans
            : (options.pending ?? []).map((p) => ({ concept: 'pago_capital', status: 'pending', ...p }));
        const data = rows.filter((row) => filters.every(([column, value]) => row[column] === value));
        return resolve(
          table === 'loans' && options.loansError
            ? { data: null, error: options.loansError }
            : { data, error: null },
        );
      },
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

  it('RN-4.29: receipts that are not pending and other concepts do not use up the balance', async () => {
    const pending = [
      { loan_id: 'loan-1', amount: 700000, receipt_id: 'a', status: 'approved' },
      { loan_id: 'loan-1', amount: 700000, receipt_id: 'b', status: 'rejected' },
      { loan_id: 'loan-1', amount: 700000, receipt_id: 'c', concept: 'pago_intereses' },
    ];
    const r = await validateCapitalPayments(fakeClient({ loans: [loan], pending }), {
      items: [capital(1000000)],
      countPending: true,
    });
    expect(r.ok).toBe(true);
  });

  it('never reveals the balance of a loan of another shareholder', async () => {
    const foreign = { ...loan, user_id: 'someone-else' };
    const r = await validateCapitalPayments(fakeClient({ loans: [foreign] }), {
      items: [capital(999999999)],
      countPending: true,
      ownerId: 'me',
    });
    // Left to the database trigger, which answers loan_payment_user_mismatch.
    expect(r.ok).toBe(true);
  });

  it('still validates the loans of the receipt owner', async () => {
    const mine = { ...loan, user_id: 'me' };
    const r = await validateCapitalPayments(fakeClient({ loans: [mine] }), {
      items: [capital(1000001)],
      countPending: true,
      ownerId: 'me',
    });
    expect(r.ok).toBe(false);
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
