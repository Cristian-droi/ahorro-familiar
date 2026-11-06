import 'server-only';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/types/database';
import type { FilaDeAjuste } from '@/modules/parametros/domain/validar-ajustes';

// `system_settings` access with the service role: authenticated users can
// only read the table, so the admin settings route writes through here after
// it checked the caller is admin and validated every value.

export type ResultadoDeRepo<T> = { ok: true; value: T } | { ok: false; mensaje: string };

export async function leerAjustes(claves: string[]): Promise<ResultadoDeRepo<FilaDeAjuste[]>> {
  const { data, error } = await createSupabaseAdminClient()
    .from('system_settings')
    .select('key, value')
    .in('key', claves);
  if (error) return { ok: false, mensaje: error.message };
  return { ok: true, value: data ?? [] };
}

// One transaction for every row: all of them are saved and audited, or none (RN-9).
export async function guardarAjustes(
  filas: { key: string; value: Json }[],
  actorId: string,
): Promise<ResultadoDeRepo<null>> {
  const { error } = await createSupabaseAdminClient().rpc('apply_audited_settings', {
    p_rows: filas,
    p_actor: actorId,
  });
  if (error) return { ok: false, mensaje: error.message };
  return { ok: true, value: null };
}
