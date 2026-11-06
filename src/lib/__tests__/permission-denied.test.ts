import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { getMyPendingLoanSharePurchases, isPermissionDeniedError } from '@/lib/data/loans';

// PostgREST answers this when the caller (for example anon) has no EXECUTE.
const PERMISO_DENEGADO = {
  code: '42501',
  message: 'permission denied for function get_my_pending_loan_share_purchases',
  details: null,
  hint: null,
};

function clienteQueResponde(respuesta: { data: unknown; error: unknown }) {
  return { rpc: async () => respuesta } as unknown as SupabaseClient<Database>;
}

describe('isPermissionDeniedError', () => {
  it('recognizes the PostgreSQL permission denied code', () => {
    expect(isPermissionDeniedError(PERMISO_DENEGADO)).toBe(true);
  });

  it('does not treat other errors as permission denied', () => {
    expect(isPermissionDeniedError({ code: 'PGRST202', message: 'not found' })).toBe(false);
    expect(isPermissionDeniedError(new Error('network'))).toBe(false);
    expect(isPermissionDeniedError(null)).toBe(false);
  });
});

describe('getMyPendingLoanSharePurchases', () => {
  it('throws the permission error so the page can react to it', async () => {
    const error = await getMyPendingLoanSharePurchases(
      clienteQueResponde({ data: null, error: PERMISO_DENEGADO }),
    ).catch((e: unknown) => e);
    expect(isPermissionDeniedError(error)).toBe(true);
  });

  it('keeps mapping rows to numbers when the call succeeds', async () => {
    const filas = await getMyPendingLoanSharePurchases(
      clienteQueResponde({
        data: [
          {
            loan_id: 'l1',
            loan_created_at: '2026-10-01T15:00:00Z',
            requested_amount: 1000000,
            loan_shares_count: 3,
            loan_shares_amount: 300000,
            unit_value: 100000,
          },
        ],
        error: null,
      }),
    );
    expect(filas).toEqual([
      {
        loan_id: 'l1',
        loan_created_at: '2026-10-01T15:00:00Z',
        requested_amount: 1000000,
        loan_shares_count: 3,
        loan_shares_amount: 300000,
        unit_value: 100000,
      },
    ]);
  });
});
