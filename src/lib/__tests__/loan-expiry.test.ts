import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { EXPIRED_REQUEST_MESSAGE, expireLoanRequestIfDue, isLoanRequestExpired } from '@/lib/loan-expiry';

// 1 October 2026, 10:00 in Bogota (UTC-5).
const ENVIADA = '2026-10-01T15:00:00.000Z';
// Instants in Bogota: 16 October 23:00 (15 days) and 17 October 00:30 (16 days).
const DIA_15 = new Date('2026-10-17T04:00:00.000Z');
const DIA_16 = new Date('2026-10-17T05:30:00.000Z');

describe('isLoanRequestExpired (RN-4.5b)', () => {
  it('RN-4.5b: a request sent 15 days ago in Bogota is still valid', () => {
    expect(isLoanRequestExpired({ status: 'pending_review', submitted_at: ENVIADA }, DIA_15)).toBe(false);
  });

  it('RN-4.5b: a request sent 16 days ago in Bogota is expired', () => {
    expect(isLoanRequestExpired({ status: 'pending_review', submitted_at: ENVIADA }, DIA_16)).toBe(true);
  });

  it.each(['pending_review', 'pending_shareholder_vote', 'pending_disbursement'])(
    'RN-4.5b: a request waiting in %s can expire',
    (status) => {
      expect(isLoanRequestExpired({ status, submitted_at: ENVIADA }, DIA_16)).toBe(true);
    },
  );

  it.each(['draft', 'active', 'paid', 'rejected_by_admin', 'rejected_by_shareholders', 'expired'])(
    'RN-4.5b: a loan in %s never expires',
    (status) => {
      expect(isLoanRequestExpired({ status, submitted_at: ENVIADA }, DIA_16)).toBe(false);
    },
  );

  it('without a submission time the request is not expired', () => {
    expect(isLoanRequestExpired({ status: 'pending_review', submitted_at: null }, DIA_16)).toBe(false);
    expect(isLoanRequestExpired({ status: 'pending_review', submitted_at: 'not a date' }, DIA_16)).toBe(false);
  });
});

// Records the update the helper sends to `loans`.
function fakeAdmin(resultError: { message: string } | null = null, filasActualizadas = 1) {
  const calls: { table: string; values: unknown; filters: [string, unknown][] }[] = [];
  const client = {
    from(table: string) {
      return {
        update(values: unknown) {
          const call = { table, values, filters: [] as [string, unknown][] };
          calls.push(call);
          const builder = {
            eq(column: string, value: unknown) {
              call.filters.push([column, value]);
              return builder;
            },
            select() {
              return builder;
            },
            then(resolve: (r: { data: { id: string }[] | null; error: { message: string } | null }) => void) {
              resolve({
                data: resultError ? null : Array.from({ length: filasActualizadas }, () => ({ id: 'loan-1' })),
                error: resultError,
              });
            },
          };
          return builder;
        },
      };
    },
  };
  return { admin: client as unknown as SupabaseClient<Database>, calls };
}

describe('expireLoanRequestIfDue (RN-4.5b)', () => {
  it('RN-4.5b: marks an expired request as expired, only if its status did not change', async () => {
    const { admin, calls } = fakeAdmin();
    const vencida = await expireLoanRequestIfDue(
      admin,
      { id: 'loan-1', status: 'pending_shareholder_vote', submitted_at: ENVIADA },
      DIA_16,
    );
    expect(vencida).toBe(true);
    expect(calls).toEqual([
      {
        table: 'loans',
        values: { status: 'expired', updated_at: DIA_16.toISOString() },
        filters: [
          ['id', 'loan-1'],
          ['status', 'pending_shareholder_vote'],
        ],
      },
    ]);
  });

  it('RN-4.5b: leaves a valid request untouched', async () => {
    const { admin, calls } = fakeAdmin();
    const vencida = await expireLoanRequestIfDue(
      admin,
      { id: 'loan-1', status: 'pending_review', submitted_at: ENVIADA },
      DIA_15,
    );
    expect(vencida).toBe(false);
    expect(calls).toEqual([]);
  });

  it('RN-4.5b: still blocks the action when the status update fails', async () => {
    const { admin } = fakeAdmin({ message: 'boom' });
    const vencida = await expireLoanRequestIfDue(
      admin,
      { id: 'loan-1', status: 'pending_disbursement', submitted_at: ENVIADA },
      DIA_16,
    );
    expect(vencida).toBe(true);
  });

  it('RN-4.5b: does not report an expiry when another action changed the status meanwhile', async () => {
    const { admin } = fakeAdmin(null, 0);
    const vencida = await expireLoanRequestIfDue(
      admin,
      { id: 'loan-1', status: 'pending_disbursement', submitted_at: ENVIADA },
      DIA_16,
    );
    expect(vencida).toBe(false);
  });

  it('RN-4.5b: the message tells the shareholder to request again', () => {
    expect(EXPIRED_REQUEST_MESSAGE).toBe(
      'La solicitud venció: pasaron más de 15 días sin desembolso. Vuelve a hacerla.',
    );
  });
});
