import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/types/database';

// RN-9.1 and RN-9.2: an administrative change and its audit record, in one
// transaction. The database reads the previous values and marks actions on the
// actor's own loan or receipt (RN-9.4). expectedStatus is the status the route
// checked: the database refuses the change if another request moved it since.
export async function auditedUpdate(
  admin: SupabaseClient<Database>,
  args: {
    entity: 'loans' | 'receipts';
    id: string;
    patch: { [key: string]: Json | undefined };
    actorId: string;
    action: string;
    expectedStatus: string;
    reason?: string;
  },
) {
  const { error } = await admin.rpc('apply_audited_update', {
    p_entity: args.entity,
    p_id: args.id,
    p_patch: args.patch,
    p_actor: args.actorId,
    p_action: args.action,
    p_expected_status: args.expectedStatus,
    ...(args.reason ? { p_reason: args.reason } : {}),
  });
  return { error };
}

// Replaces the items of a rejected receipt and reopens it, all or nothing.
export async function resubmitReceipt(
  admin: SupabaseClient<Database>,
  args: {
    id: string;
    actorId: string;
    items: Json[];
    patch: { [key: string]: Json | undefined };
  },
) {
  const { error } = await admin.rpc('resubmit_receipt', {
    p_receipt_id: args.id,
    p_actor: args.actorId,
    p_items: args.items,
    p_patch: args.patch,
  });
  return { error };
}

export function isStaleStatus(error: { message: string } | null): boolean {
  return error?.message?.includes('audit_status_conflict') ?? false;
}
