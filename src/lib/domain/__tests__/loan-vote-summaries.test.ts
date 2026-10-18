import { describe, it, expect } from 'vitest';
import { LoanRepository } from '@/lib/domain/repositories/LoanRepository';

type VoteRow = { loan_id: string; vote: string };

// Minimal stand-in for the Supabase query builder used by getVoteSummaries:
// from('loan_votes').select(...).in('loan_id', ids).
function fakeClient(rows: VoteRow[], error: unknown = null) {
  return {
    from: () => ({
      select: () => ({
        in: async (_column: string, ids: string[]) => ({
          data: rows.filter((r) => ids.includes(r.loan_id)),
          error,
        }),
      }),
    }),
  } as unknown as ConstructorParameters<typeof LoanRepository>[0];
}

describe('LoanRepository.getVoteSummaries', () => {
  it('returns an empty map without querying when no ids are given', async () => {
    const repo = new LoanRepository(fakeClient([]));
    expect((await repo.getVoteSummaries([])).size).toBe(0);
  });

  it("counts 'approved' and 'rejected' votes per loan", async () => {
    const repo = new LoanRepository(
      fakeClient([
        { loan_id: 'l1', vote: 'approved' },
        { loan_id: 'l1', vote: 'approved' },
        { loan_id: 'l1', vote: 'rejected' },
        { loan_id: 'l2', vote: 'rejected' },
      ]),
    );
    const map = await repo.getVoteSummaries(['l1', 'l2']);
    expect(map.get('l1')).toEqual({ approved: 2, rejected: 1 });
    expect(map.get('l2')).toEqual({ approved: 0, rejected: 1 });
  });

  it('initializes loans without votes to zero', async () => {
    const repo = new LoanRepository(fakeClient([]));
    const map = await repo.getVoteSummaries(['l3']);
    expect(map.get('l3')).toEqual({ approved: 0, rejected: 0 });
  });

  it('ignores unknown vote values', async () => {
    const repo = new LoanRepository(fakeClient([{ loan_id: 'l1', vote: 'abstained' }]));
    const map = await repo.getVoteSummaries(['l1']);
    expect(map.get('l1')).toEqual({ approved: 0, rejected: 0 });
  });

  it('throws when the query fails', async () => {
    const repo = new LoanRepository(fakeClient([], new Error('db down')));
    await expect(repo.getVoteSummaries(['l1'])).rejects.toThrow('db down');
  });
});
