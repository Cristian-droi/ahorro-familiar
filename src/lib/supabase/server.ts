import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/types/database';

// Cliente Supabase para uso dentro de Route Handlers y Server Components.
// Respeta RLS y la sesión del usuario.
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name) {
          return cookieStore.get(name)?.value;
        },
        set() {
          // Read-only en este helper. Si se necesita escribir cookies,
          // usar el patrón del middleware.
        },
        remove() {},
      },
    },
  );
}
