-- =============================================================================
-- Revocar los default privileges amplios del schema `public`.
--
-- Contexto:
--   - Por defecto, Supabase da a `anon` y `authenticated` todos los privilegios
--     (arwdDxtm) sobre las tablas futuras creadas por `postgres`, más uso de
--     secuencias y EXECUTE sobre funciones. La migración
--     `20260418220000_grant_roles.sql` además reforzó esos defaults.
--   - Con eso, toda tabla nueva nace con CRUD para `anon` y solo la protege RLS.
--
-- Qué hace:
--   1. Tablas y secuencias futuras: sin privilegios para `anon` ni
--      `authenticated`. Cada migración que crea una tabla debe dar sus GRANTs
--      explícitos (ver docs/convenciones.md, sección 6).
--   2. Funciones futuras: sin EXECUTE para `anon`. `authenticated` y
--      `service_role` lo conservan. Postgres da EXECUTE a PUBLIC por defecto
--      (y `anon` lo hereda), así que también se revoca a nivel global.
--   3. Elimina `_test_anon_insert`, una función de depuración creada a mano
--      en la nube.
--
-- Qué NO hace:
--   - No toca los privilegios de las tablas ni funciones que ya existen.
--     Eso se ajusta en la S4 (escrituras de dinero solo desde el servidor).
--
-- Idempotente.
-- =============================================================================

-- 1. Tablas y secuencias futuras
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;

-- 2. Funciones futuras
alter default privileges for role postgres
  revoke execute on functions from public;

alter default privileges for role postgres in schema public
  revoke execute on functions from anon;

-- 3. Función de depuración
drop function if exists public._test_anon_insert();
