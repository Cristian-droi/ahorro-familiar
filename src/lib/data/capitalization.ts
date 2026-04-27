// Helpers para el modelo v2 de ventanas de capitalización (tabla
// `capitalization_windows`). Hay dos scopes:
//   - 'global': aplica a todos los accionistas que no tengan ventana
//     individual. Sin tope.
//   - 'user':   aplica solo a ese accionista. Tope max_amount. ANULA la
//     global para él.
//
// Acceso vía RPCs SECURITY DEFINER:
//   - get_my_capitalization_state         (accionista)
//   - get_capitalization_windows_admin    (admin lista activas)
//   - open_capitalization_window_v2       (admin)
//   - close_capitalization_window_v2      (admin)

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

type Client = SupabaseClient<Database>;

// =============================================================================
// Estado del accionista
// =============================================================================
export type MyCapState =
  | { allowed: false; reason?: string }
  | {
      allowed: true;
      scope: 'global' | 'user';
      window_id: string;
      max_amount: number | null;
      used: number | null;
      remaining: number | null;
      deadline: string; // 'YYYY-MM-DD'
    };

function parseMyState(raw: unknown): MyCapState {
  const v = (raw ?? {}) as Record<string, unknown>;
  if (!v.allowed) {
    return {
      allowed: false,
      reason: typeof v.reason === 'string' ? v.reason : undefined,
    };
  }
  const scope = v.scope === 'user' ? 'user' : 'global';
  return {
    allowed: true,
    scope,
    window_id: String(v.window_id ?? ''),
    max_amount: v.max_amount == null ? null : Number(v.max_amount),
    used: v.used == null ? null : Number(v.used),
    remaining: v.remaining == null ? null : Number(v.remaining),
    deadline: String(v.deadline ?? ''),
  };
}

export async function getMyCapitalizationState(client: Client): Promise<MyCapState> {
  const { data, error } = await client.rpc('get_my_capitalization_state');
  if (error) throw error;
  return parseMyState(data);
}

// =============================================================================
// Lista admin
// =============================================================================
export type AdminCapWindow = {
  id: string;
  scope: 'global' | 'user';
  user_id: string | null;
  user_name: string | null;
  user_document: string | null;
  max_amount: number | null;
  used_amount: number;
  remaining: number | null;
  deadline: string;
  opened_at: string;
};

export async function listAdminCapitalizationWindows(
  client: Client,
): Promise<AdminCapWindow[]> {
  const { data, error } = await client.rpc('get_capitalization_windows_admin');
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    scope: row.scope === 'user' ? 'user' : 'global',
    user_id: row.user_id,
    user_name: row.user_name,
    user_document: row.user_document,
    max_amount: row.max_amount == null ? null : Number(row.max_amount),
    used_amount: Number(row.used_amount ?? 0),
    remaining: row.remaining == null ? null : Number(row.remaining),
    deadline: row.deadline,
    opened_at: row.opened_at,
  }));
}

// =============================================================================
// Mutaciones admin
// =============================================================================
export async function openGlobalCapitalizationWindow(
  client: Client,
  args: { deadline: string },
): Promise<string> {
  // p_user_id y p_max_amount son NULL para scope='global'. Los types
  // generados los marcan como string/number obligatorios; casteamos para
  // evitar el chequeo (la función SQL acepta NULL en scope global).
  const { data, error } = await client.rpc('open_capitalization_window_v2', {
    p_scope: 'global',
    p_user_id: null,
    p_max_amount: null,
    p_deadline: args.deadline,
  } as never);
  if (error) throw error;
  return String(data);
}

export async function openUserCapitalizationWindow(
  client: Client,
  args: { userId: string; maxAmount: number; deadline: string },
): Promise<string> {
  const { data, error } = await client.rpc('open_capitalization_window_v2', {
    p_scope: 'user',
    p_user_id: args.userId,
    p_max_amount: args.maxAmount,
    p_deadline: args.deadline,
  });
  if (error) throw error;
  return String(data);
}

export async function closeCapitalizationWindowV2(
  client: Client,
  windowId: string,
): Promise<void> {
  const { error } = await client.rpc('close_capitalization_window_v2', {
    p_window_id: windowId,
  });
  if (error) throw error;
}
