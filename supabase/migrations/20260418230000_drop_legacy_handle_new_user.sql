-- Elimina el trigger legacy `on_auth_user_created` y su función
-- `handle_new_user()`, heredados de un schema anterior.
--
-- Motivación:
--  1. La función intenta insertar en public.profiles.is_admin, columna que
--     fue reemplazada por profiles.role en 20260417120000_schema_and_rls.sql.
--     Al dispararse el trigger tras `createUser` falla con "Database error
--     creating new user" y aborta toda creación de usuario.
--  2. El flujo actual de aprobación (src/app/api/solicitudes/approve/route.ts)
--     crea el profile explícitamente con `upsertProfile`, con el rol correcto
--     y todos los datos de la solicitud. El trigger ya no aporta nada.
--
-- A partir de aquí, la única fuente de verdad para crear profiles es el
-- backend de la aplicación.

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
