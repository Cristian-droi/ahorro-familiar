import { describe, it, expect } from 'vitest';
import { LoanRepository } from '@/lib/domain/repositories/LoanRepository';

type TotalsRow = { loan_id: string; approved: number; rejected: number };

// Minimal stand-in for the Supabase client used by getVoteSummaries:
// rpc('get_loan_vote_totals', { p_loan_ids }). RN-4.9b: only totals reach the
// app, and from('loan_votes') must not be used because it hides other votes.
function fakeClient(rows: TotalsRow[], error: unknown = null) {
  return {
    rpc: async (name: string, args: { p_loan_ids: string[] }) => {
      if (name !== 'get_loan_vote_totals') throw new Error(`unexpected rpc ${name}`);
      return { data: rows.filter((r) => args.p_loan_ids.includes(r.loan_id)), error };
    },
    from: () => {
      throw new Error('getVoteSummaries must not read loan_votes directly');
    },
  } as unknown as ConstructorParameters<typeof LoanRepository>[0];
}

describe('LoanRepository.getVoteSummaries', () => {
  it('returns an empty map without querying when no ids are given', async () => {
    const repo = new LoanRepository(fakeClient([]));
    expect((await repo.getVoteSummaries([])).size).toBe(0);
  });

  it('returns the approved and rejected totals per loan', async () => {
    const repo = new LoanRepository(
      fakeClient([
        { loan_id: 'l1', approved: 2, rejected: 1 },
        { loan_id: 'l2', approved: 0, rejected: 1 },
      ]),
    );
    const map = await repo.getVoteSummaries(['l1', 'l2']);
    expect(map.get('l1')).toEqual({ approved: 2, rejected: 1 });
    expect(map.get('l2')).toEqual({ approved: 0, rejected: 1 });
  });

  it('initializes loans without totals to zero', async () => {
    const repo = new LoanRepository(fakeClient([]));
    const map = await repo.getVoteSummaries(['l3']);
    expect(map.get('l3')).toEqual({ approved: 0, rejected: 0 });
  });

  it('throws when the query fails', async () => {
    const repo = new LoanRepository(fakeClient([], new Error('db down')));
    await expect(repo.getVoteSummaries(['l1'])).rejects.toThrow('db down');
  });
});
