import type {
  MembershipRequestInsert,
  MembershipRequestRow,
  TypedSupabaseClient,
} from './types';

export type { MembershipRequestRow };

// Repositorio de solicitudes de ingreso. Las funciones reciben el cliente
// Supabase como parámetro para poder llamarse desde contextos distintos
// (browser / server / admin) sin acoplarse a uno.

export async function countPendingMembershipRequests(
  client: TypedSupabaseClient,
): Promise<number> {
  const { count, error } = await client
    .from('membership_requests')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');

  if (error) throw error;
  return count ?? 0;
}

export async function listMembershipRequests(client: TypedSupabaseClient) {
  const { data, error } = await client
    .from('membership_requests')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function getMembershipRequest(
  client: TypedSupabaseClient,
  id: string,
) {
  const { data, error } = await client
    .from('membership_requests')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
}

export async function createMembershipRequest(
  client: TypedSupabaseClient,
  row: MembershipRequestInsert,
) {
  // Nota importante sobre RLS:
  // No usamos `.select().single()` aquí porque eso genera un
  // `INSERT ... RETURNING *`, y para devolver filas PostgREST exige que el
  // rol tenga una policy de SELECT. El formulario público corre como `anon`,
  // que NO tiene policy de SELECT sobre membership_requests (solo los admin
  // pueden leer). Con RETURNING, Postgres rechaza la operación con el
  // (engañoso) mensaje "new row violates row-level security policy".
  //
  // El formulario no necesita leer la fila insertada: basta con saber si
  // el insert tuvo éxito, así que omitimos el RETURNING.
  const { error } = await client.from('membership_requests').insert(row);

  // Error conocido: violación de unique constraint en identity_document.
  if (error) throw error;
}

export function isDuplicateDocumentError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505' &&
    'message' in error &&
    typeof (error as { message?: string }).message === 'string' &&
    (error as { message: string }).message.includes('identity_document')
  );
}

export async function updateMembershipRequestStatus(
  client: TypedSupabaseClient,
  id: string,
  status: 'approved' | 'rejected',
  rejectionReason?: string,
) {
  const { error } = await client
    .from('membership_requests')
    .update({
      status,
      rejection_reason: rejectionReason ?? null,
    })
    .eq('id', id);

  if (error) throw error;
}
