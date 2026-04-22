-- Concede a los roles anon / authenticated los privilegios base que necesitan
-- para que las policies RLS puedan evaluarse. Sin estos GRANTs, Postgres
-- rechaza la operación antes de ejecutar RLS y la policy nunca aplica.
--
-- Este fix se hizo necesario al migrar un proyecto Supabase cuyo schema
-- `public` había perdido los default privileges estándar.

-- Permisos mínimos por tabla. Cada policy RLS decide qué filas son visibles;
-- el GRANT solo habilita al rol para intentar la operación.

grant select, insert on public.membership_requests to anon;
grant select, insert, update, delete on public.membership_requests to authenticated;

grant select, insert, update, delete on public.profiles to authenticated;

-- Uso del schema (necesario para que los roles puedan resolver los objetos).
grant usage on schema public to anon, authenticated;

-- Asegurar que los defaults del schema cubran tablas futuras.
alter default privileges in schema public
  grant select, insert on tables to anon;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
