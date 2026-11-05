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

// One upsert for every row: all of them are saved, or none.
export async function guardarAjustes(
  filas: { key: string; value: Json }[],
  ahora: string,
): Promise<ResultadoDeRepo<null>> {
  const { error } = await createSupabaseAdminClient()
    .from('system_settings')
    .upsert(filas.map((f) => ({ key: f.key, value: f.value, updated_at: ahora })));
  if (error) return { ok: false, mensaje: error.message };
  return { ok: true, value: null };
}
