import type { TypedSupabaseClient } from './types';
import {
  MENSAJE_PERIODO_NO_ABIERTO,
  MENSAJE_VALOR_BLOQUEADO_POR_COMPRA,
  MENSAJE_VALOR_YA_ELEGIDO,
} from '@/modules/acciones/domain/valor-de-accion';

// Share value of the open period (RN-2.2). The single source of truth for
// every reader: never query `period_memberships` inline. Null means the
// shareholder has not chosen a value yet and cannot buy shares (RN-2.3).

const OPEN_PERIOD_MEMBERSHIP = 'profile_id, share_value, periods!inner(status)';

export async function getOpenPeriodShareValue(
  client: TypedSupabaseClient,
  profileId: string,
): Promise<number | null> {
  const { data, error } = await client
    .from('period_memberships')
    .select(OPEN_PERIOD_MEMBERSHIP)
    .eq('periods.status', 'open')
    .eq('profile_id', profileId)
    .maybeSingle();

  if (error) throw error;
  return data?.share_value != null ? Number(data.share_value) : null;
}

// profile_id -> share value for the open period. Profiles without a chosen
// value are left out, so `map.get(id) ?? null` reads as "not chosen".
export async function listOpenPeriodShareValues(
  client: TypedSupabaseClient,
): Promise<Map<string, number>> {
  const { data, error } = await client
    .from('period_memberships')
    .select(OPEN_PERIOD_MEMBERSHIP)
    .eq('periods.status', 'open')
    .not('share_value', 'is', null);

  if (error) throw error;
  const values = new Map<string, number>();
  for (const row of data ?? []) {
    if (row.share_value != null) values.set(row.profile_id, Number(row.share_value));
  }
  return values;
}

// Status of the open period, or null when no period is open.
export async function getOpenPeriodStatus(
  client: TypedSupabaseClient,
): Promise<'open' | null> {
  const { data, error } = await client
    .from('periods')
    .select('status')
    .eq('status', 'open')
    .maybeSingle();

  if (error) throw error;
  return data ? 'open' : null;
}

// The open-period membership of one profile: its share value (null while not
// chosen) and whether the administrator allowed one change (RN-2.2). Null
// when the profile has no membership in the open period.
export type OpenPeriodMembership = {
  shareValue: number | null;
  changeAllowed: boolean;
};

export async function getOpenPeriodMembership(
  client: TypedSupabaseClient,
  profileId: string,
): Promise<OpenPeriodMembership | null> {
  const { data, error } = await client
    .from('period_memberships')
    .select('share_value, share_value_change_allowed, periods!inner(status)')
    .eq('periods.status', 'open')
    .eq('profile_id', profileId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return {
    shareValue: data.share_value != null ? Number(data.share_value) : null,
    changeAllowed: data.share_value_change_allowed,
  };
}

// Profiles allowed to change their open-period share value (RN-2.2). Only
// profiles with a chosen value can hold the permission.
export async function listOpenPeriodShareValueChangesAllowed(
  client: TypedSupabaseClient,
): Promise<Set<string>> {
  const { data, error } = await client
    .from('period_memberships')
    .select('profile_id, periods!inner(status)')
    .eq('periods.status', 'open')
    .eq('share_value_change_allowed', true);

  if (error) throw error;
  return new Set((data ?? []).map((row) => row.profile_id));
}

// Year of the open period, or null when no period is open.
async function getOpenPeriodYear(client: TypedSupabaseClient): Promise<number | null> {
  const { data, error } = await client
    .from('periods')
    .select('year')
    .eq('status', 'open')
    .maybeSingle();

  if (error) throw error;
  return data ? data.year : null;
}

// Pending or approved receipt items with shares for a month of the open
// period's year (same rule as has_share_receipts_in_period). Under RLS a
// shareholder sees only their own receipts; the administrator sees all.
async function listShareReceiptOwnersInOpenPeriod(
  client: TypedSupabaseClient,
  profileId?: string,
): Promise<Set<string>> {
  const year = await getOpenPeriodYear(client);
  if (year === null) return new Set();

  let query = client
    .from('receipt_items')
    .select('receipts!inner(user_id, status)')
    .eq('concept', 'acciones')
    .gte('target_month', `${year}-01-01`)
    .lte('target_month', `${year}-12-31`)
    .in('receipts.status', ['pending', 'approved']);
  if (profileId) query = query.eq('receipts.user_id', profileId).limit(1);

  const { data, error } = await query;
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.receipts.user_id));
}

// RN-2.2: after the first share receipt (pending or approved) the value is
// fixed until the next period.
export async function hasShareReceiptsInOpenPeriod(
  client: TypedSupabaseClient,
  profileId: string,
): Promise<boolean> {
  const owners = await listShareReceiptOwnersInOpenPeriod(client, profileId);
  return owners.has(profileId);
}

// Profiles with a share receipt in the open period (admin lists).
export async function listProfilesWithShareReceiptsInOpenPeriod(
  client: TypedSupabaseClient,
): Promise<Set<string>> {
  return listShareReceiptOwnersInOpenPeriod(client);
}

// Spanish messages for the database errors of choose_share_value. Null when
// the error is not a known business rule.
export function shareValueChoiceErrorMessage(dbMessage: string): string | null {
  // Check the longer code first: it contains `share_value_locked`.
  if (dbMessage.includes('share_value_locked_by_purchase')) return MENSAJE_VALOR_BLOQUEADO_POR_COMPRA;
  if (dbMessage.includes('share_value_locked')) return MENSAJE_VALOR_YA_ELEGIDO;
  if (dbMessage.includes('period_not_open')) return MENSAJE_PERIODO_NO_ABIERTO;
  // The allowed values changed between the route check and the RPC.
  if (dbMessage.includes('share_value_not_allowed')) {
    return 'El valor de la acción ya no está entre los permitidos. Recarga la página y elige otro.';
  }
  return null;
}

// Errors of allow_share_value_change, with the HTTP status the admin route
// answers. Null when the error is not a known business rule.
export function shareValueChangePermissionError(
  dbMessage: string,
): { status: 400 | 403; message: string } | null {
  if (dbMessage.includes('not_admin')) {
    return { status: 403, message: 'Acceso restringido a administradores' };
  }
  if (dbMessage.includes('share_value_locked_by_purchase')) {
    return {
      status: 400,
      message: 'Este accionista ya compró acciones con su valor. Podrá cambiarlo en el próximo periodo.',
    };
  }
  if (dbMessage.includes('share_value_not_chosen')) {
    return { status: 400, message: 'Este accionista todavía no eligió el valor de su acción.' };
  }
  if (dbMessage.includes('period_not_open')) {
    return { status: 400, message: 'No hay un periodo abierto. El cambio de valor solo se habilita con el periodo abierto.' };
  }
  return null;
}
