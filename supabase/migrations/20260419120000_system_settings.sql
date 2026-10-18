-- =============================================================================
-- Tabla de configuración del sistema (`system_settings`).
--
-- Contexto:
--   - La tabla se creó originalmente desde el panel de Supabase, sin migración.
--     Por eso `supabase start` fallaba en `20260420000000_purchases_module.sql`,
--     que ya hace `insert into public.system_settings`.
--   - Esta migración la crea para que el esquema sea reproducible desde cero.
--     Usa `if not exists` para no chocar con la tabla que ya existe en la nube.
--
-- Seguridad:
--   - RLS activo.
--   - Los usuarios autenticados solo pueden leer.
--   - Sin policies de insert/update/delete → solo service_role puede mutar.
--
-- Idempotente.
-- =============================================================================

create table if not exists public.system_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz default now()
);

alter table public.system_settings enable row level security;

drop policy if exists "system_settings_select_authenticated" on public.system_settings;
create policy "system_settings_select_authenticated"
  on public.system_settings
  for select
  to authenticated
  using (true);

grant select on public.system_settings to authenticated;
