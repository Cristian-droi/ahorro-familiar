import { describe, it, expect } from 'vitest';
import { eligibleVoterCount, getShareholderIds } from '@/lib/data/votes';
import { votantesHabilitados, votosNecesarios } from '@/modules/prestamos/domain/votacion';

// Regression for docs/reglas-negocio.md section 11, n.º 8: `count_active_shareholders()`
// includes the applicant, so n came out one too high.
describe('eligibleVoterCount (RN-4.6)', () => {
  it('excludes a shareholder applicant: 20 shareholders give n = 19 and 10 votes needed', () => {
    const n = eligibleVoterCount({ totalShareholders: 20, applicantRole: 'accionista' });
    expect(n).toBe(19);
    expect(votosNecesarios(n)).toBe(10);
  });

  it('counts an applicant whose role is hidden by RLS as a shareholder', () => {
    expect(eligibleVoterCount({ totalShareholders: 20, applicantRole: null })).toBe(19);
    expect(eligibleVoterCount({ totalShareholders: 20, applicantRole: undefined })).toBe(19);
  });

  it('does not subtract an admin applicant, who is not in the shareholder count', () => {
    expect(eligibleVoterCount({ totalShareholders: 20, applicantRole: 'admin' })).toBe(20);
  });

  it('never goes below zero', () => {
    expect(eligibleVoterCount({ totalShareholders: 0, applicantRole: 'accionista' })).toBe(0);
  });
});

describe('getShareholderIds', () => {
  function fakeClient(rows: Array<{ id: string; role: string }>, error: unknown = null) {
    return {
      from: () => ({
        select: () => ({
          eq: async (_column: string, value: string) => ({
            data: error ? null : rows.filter((r) => r.role === value).map(({ id }) => ({ id })),
            error,
          }),
        }),
      }),
    } as unknown as Parameters<typeof getShareholderIds>[0];
  }

  it("returns only 'accionista' ids, and n excludes the applicant from them", async () => {
    const ids = await getShareholderIds(
      fakeClient([
        { id: 'a', role: 'accionista' },
        { id: 'b', role: 'accionista' },
        { id: 'c', role: 'accionista' },
        { id: 'x', role: 'admin' },
      ]),
    );
    expect(ids).toEqual(['a', 'b', 'c']);
    expect(votantesHabilitados({ accionistasActivos: ids, solicitanteId: 'a' })).toBe(2);
  });

  it('throws the query error', async () => {
    const boom = new Error('boom');
    await expect(getShareholderIds(fakeClient([], boom))).rejects.toBe(boom);
  });
});
