import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/types/database';

// RN-9.1 and RN-9.2: an administrative change and its audit record, in one
// transaction. The database reads the previous values and marks actions on the
// actor's own loan or receipt (RN-9.4).
export async function auditedUpdate(
  admin: SupabaseClient<Database>,
  args: {
    entity: 'loans' | 'receipts';
    id: string;
    patch: { [key: string]: Json | undefined };
    actorId: string;
    action: string;
    reason?: string;
  },
) {
  const { error } = await admin.rpc('apply_audited_update', {
    p_entity: args.entity,
    p_id: args.id,
    p_patch: args.patch,
    p_actor: args.actorId,
    p_action: args.action,
    ...(args.reason ? { p_reason: args.reason } : {}),
  });
  return { error };
}
