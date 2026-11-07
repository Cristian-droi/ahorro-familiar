import 'server-only';
import { createSupabaseServerClient } from './supabase/server';
import { getProfileAdminRole, getProfileRole } from './data/profiles';
import { puedeEscribirAdmin } from '@/shared/domain/acceso-admin';

// Requires an active session and the tesorero role from `profiles` (never from
// user_metadata, which the user can edit). The gerente only reads, so every
// administrative write answers 403 for them. Returns { user } or { error, status }.
export async function requireAdmin() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: 'No autorizado', status: 401 as const };
  }

  const adminRole = await getProfileAdminRole(supabase, user.id);
  if (!puedeEscribirAdmin(adminRole)) {
    return { error: 'Acceso restringido a administradores', status: 403 as const };
  }

  return { user };
}

// Verifica que haya sesión activa (sin exigir rol específico). Devuelve el
// user + su role para que el caller decida qué permitir. Útil en endpoints
// que un accionista invoca sobre recursos propios.
export async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: 'No autorizado', status: 401 as const };
  }

  const role = await getProfileRole(supabase, user.id);
  return { user, role };
}
