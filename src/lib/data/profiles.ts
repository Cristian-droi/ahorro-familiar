import type {
  ProfileInsert,
  ProfileRow,
  ProfileUpdate,
  TypedSupabaseClient,
} from './types';

export type { ProfileRow };

export async function getProfile(client: TypedSupabaseClient, id: string) {
  const { data, error } = await client
    .from('profiles')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
}

export async function getProfileRole(
  client: TypedSupabaseClient,
  id: string,
): Promise<'admin' | 'accionista' | null> {
  const { data, error } = await client
    .from('profiles')
    .select('role')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data?.role ?? null;
}

export async function getProfileByDocument(
  client: TypedSupabaseClient,
  identityDocument: string,
) {
  const { data, error } = await client
    .from('profiles')
    .select('*')
    .eq('identity_document', identityDocument)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function listProfiles(client: TypedSupabaseClient) {
  const { data, error } = await client
    .from('profiles')
    .select(
      'id, identity_document, selected_share_value, share_value_change_allowed, role, bank_name, bank_account_number, bank_account_type',
    );

  if (error) throw error;
  return data ?? [];
}

// Perfiles con nombre + documento para mostrar en listas administrativas
// (Libro de caja, Extracto). No incluye accionistas sin perfil creado
// (i.e. solicitudes aprobadas sin signup aún).
export async function listProfilesWithNames(client: TypedSupabaseClient) {
  const { data, error } = await client
    .from('profiles')
    .select(
      'id, first_name, last_name, identity_document, selected_share_value, role',
    )
    .eq('role', 'accionista')
    .order('first_name');

  if (error) throw error;
  return data ?? [];
}

export async function updateProfile(
  client: TypedSupabaseClient,
  id: string,
  patch: ProfileUpdate,
) {
  const { error } = await client.from('profiles').update(patch).eq('id', id);
  if (error) throw error;
}

export async function upsertProfile(
  client: TypedSupabaseClient,
  row: ProfileInsert,
) {
  const { error } = await client
    .from('profiles')
    .upsert(row, { onConflict: 'id' });
  if (error) throw error;
}
