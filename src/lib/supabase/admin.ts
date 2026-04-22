import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

// Cliente con SERVICE ROLE: bypasea RLS. Úsalo SOLO para operaciones
// que requieren privilegios elevados (crear usuarios en Auth, seed,
// escribir en tablas protegidas desde un Route Handler que ya verificó
// que el caller es admin).
//
// NUNCA importar este módulo desde un componente cliente.
export function createSupabaseAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY no está configurada');
  }
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
