import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { auditedUpdate } from '@/lib/audit';

function fakeClient(result: { error: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc } as unknown as SupabaseClient<Database>, rpc };
}

describe('auditedUpdate (RN-9.1, RN-9.2)', () => {
  it('RN-9.2: sends who, what and why with the change, in one call', async () => {
    const { client, rpc } = fakeClient({ error: null });
    const r = await auditedUpdate(client, {
      entity: 'receipts',
      id: 'receipt-1',
      patch: { status: 'rejected' },
      actorId: 'actor-1',
      action: 'receipt.reject',
      reason: 'amount_mismatch',
    });
    expect(rpc).toHaveBeenCalledWith('apply_audited_update', {
      p_entity: 'receipts',
      p_id: 'receipt-1',
      p_patch: { status: 'rejected' },
      p_actor: 'actor-1',
      p_action: 'receipt.reject',
      p_reason: 'amount_mismatch',
    });
    expect(r.error).toBeNull();
  });

  it('RN-9.2: the reason is optional', async () => {
    const { client, rpc } = fakeClient({ error: null });
    await auditedUpdate(client, {
      entity: 'loans',
      id: 'loan-1',
      patch: { admin_notes: null },
      actorId: 'actor-1',
      action: 'loan.send_to_vote',
    });
    expect(rpc.mock.calls[0][1]).not.toHaveProperty('p_reason');
  });

  it('returns the database error so the route can answer', async () => {
    const { client } = fakeClient({ error: { message: 'boom' } });
    const r = await auditedUpdate(client, {
      entity: 'loans',
      id: 'loan-1',
      patch: {},
      actorId: 'actor-1',
      action: 'loan.send_to_vote',
    });
    expect(r.error?.message).toBe('boom');
  });
});
