import 'server-only';
import { createSupabaseServerClient } from './supabase/server';
import { getProfileRole } from './data/profiles';

// Verifica que haya sesión activa y que el usuario tenga rol admin
// según la tabla `profiles` (no según user_metadata, que es editable
// por el propio usuario). Retorna { user } si todo ok, o { error, status }.
export async function requireAdmin() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: 'No autorizado', status: 401 as const };
  }

  const role = await getProfileRole(supabase, user.id);
  if (role !== 'admin') {
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
