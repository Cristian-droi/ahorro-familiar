import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { auditedUpdate, isStaleStatus, resubmitReceipt } from '@/lib/audit';

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
      expectedStatus: 'pending',
      reason: 'amount_mismatch',
    });
    expect(rpc).toHaveBeenCalledWith('apply_audited_update', {
      p_entity: 'receipts',
      p_id: 'receipt-1',
      p_patch: { status: 'rejected' },
      p_actor: 'actor-1',
      p_action: 'receipt.reject',
      p_expected_status: 'pending',
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
      expectedStatus: 'pending_review',
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
      expectedStatus: 'pending_review',
    });
    expect(r.error?.message).toBe('boom');
  });

  it('F18: recognizes the status guard, and only the status guard', () => {
    expect(isStaleStatus({ message: 'audit_status_conflict' })).toBe(true);
    expect(isStaleStatus({ message: 'boom' })).toBe(false);
    expect(isStaleStatus(null)).toBe(false);
  });
});

describe('resubmitReceipt (F24)', () => {
  it('sends the items and the changes in one call', async () => {
    const { client, rpc } = fakeClient({ error: null });
    const items = [{ concept: 'pago_capital' as const, target_month: '2026-11-01', amount: 1000 }];
    const r = await resubmitReceipt(client, {
      id: 'receipt-1',
      actorId: 'user-1',
      items,
      patch: { status: 'pending' },
    });
    expect(rpc).toHaveBeenCalledWith('resubmit_receipt', {
      p_receipt_id: 'receipt-1',
      p_actor: 'user-1',
      p_items: items,
      p_patch: { status: 'pending' },
    });
    expect(r.error).toBeNull();
  });
});
