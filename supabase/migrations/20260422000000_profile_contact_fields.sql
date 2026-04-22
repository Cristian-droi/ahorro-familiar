-- =============================================================================
-- Campos adicionales de perfil: cuenta bancaria + verificación de correo
--
-- 1. Cuenta bancaria: columnas opcionales en `profiles` para que el accionista
--    registre a dónde se le depositará el dinero cuando saque un préstamo.
--    - bank_name             : nombre del banco (texto libre).
--    - bank_account_number   : número de cuenta (texto; soporta ceros iniciales).
--    - bank_account_type     : enum 'ahorros' | 'corriente'.
--
-- 2. Verificación de correo: tabla `email_change_requests` que guarda las
--    solicitudes pendientes de cambio del correo REAL (el que vive en
--    user_metadata.real_email, NO el de login). Cada solicitud tiene un
--    token de un solo uso con expiración. Al confirmar, un endpoint admin
--    pasa el valor a `user_metadata.real_email`.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Enum bank_account_type
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.bank_account_type as enum ('ahorros', 'corriente');
exception when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Columnas de cuenta bancaria en profiles
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists bank_name             text,
  add column if not exists bank_account_number   text,
  add column if not exists bank_account_type     public.bank_account_type;

-- -----------------------------------------------------------------------------
-- 3. Tabla email_change_requests
-- -----------------------------------------------------------------------------
create table if not exists public.email_change_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  new_email     text not null,
  token         text not null unique,
  expires_at    timestamptz not null,
  confirmed_at  timestamptz,
  canceled_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists idx_email_change_requests_user_id
  on public.email_change_requests (user_id);

create index if not exists idx_email_change_requests_token
  on public.email_change_requests (token);

-- -----------------------------------------------------------------------------
-- 4. RLS
-- -----------------------------------------------------------------------------
alter table public.email_change_requests enable row level security;

-- El usuario puede LEER sus propias solicitudes (para mostrar estado
-- "pendiente de verificación" en Ajustes). Inserción/actualización/borrado
-- solo vía service_role desde endpoints admin.
drop policy if exists "email_change_requests_select_own"
  on public.email_change_requests;
create policy "email_change_requests_select_own"
  on public.email_change_requests for select
  to authenticated
  using (user_id = auth.uid());
