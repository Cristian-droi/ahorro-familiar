import type { TypedSupabaseClient } from './types';

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
