-- =============================================================================
-- Ahorro Familiar — Schema base + RLS
-- Idempotente: se puede correr sobre una base existente sin romper datos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tipos
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.user_role as enum ('admin', 'accionista');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.request_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Tabla membership_requests
-- -----------------------------------------------------------------------------
create table if not exists public.membership_requests (
  id                  uuid primary key default gen_random_uuid(),
  first_name          text not null,
  last_name           text not null,
  phone               text not null,
  email               text not null,
  address             text not null,
  identity_document   text not null unique,
  monthly_income      numeric(14, 2) not null check (monthly_income >= 0),
  status              public.request_status not null default 'pending',
  rejection_reason    text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_membership_requests_status
  on public.membership_requests (status);

-- -----------------------------------------------------------------------------
-- 3. Tabla profiles
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id                      uuid primary key references auth.users (id) on delete cascade,
  first_name              text not null,
  last_name               text not null default '',
  identity_document       text not null unique,
  phone                   text,
  address                 text,
  monthly_income          numeric(14, 2),
  role                    public.user_role not null default 'accionista',
  selected_share_value    numeric(14, 2),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- CREATE TABLE IF NOT EXISTS no toca tablas preexistentes, así que
-- garantizamos explícitamente cada columna que introdujo esta migración.
alter table public.profiles
  add column if not exists role              public.user_role not null default 'accionista',
  add column if not exists created_at        timestamptz not null default now(),
  add column if not exists updated_at        timestamptz not null default now(),
  add column if not exists last_name         text not null default '',
  add column if not exists phone             text,
  add column if not exists address           text,
  add column if not exists monthly_income    numeric(14, 2),
  add column if not exists selected_share_value numeric(14, 2);

alter table public.membership_requests
  add column if not exists status            public.request_status not null default 'pending',
  add column if not exists rejection_reason  text,
  add column if not exists created_at        timestamptz not null default now(),
  add column if not exists updated_at        timestamptz not null default now();

-- Migración suave: si aún existe la columna legacy `is_admin`, la convertimos.
-- EXECUTE evita que el parser valide columnas recién creadas/dropeadas.
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_admin'
  ) then
    execute $m$ update public.profiles set role = 'admin' where is_admin = true $m$;
    execute $m$ alter table public.profiles drop column is_admin $m$;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Trigger updated_at
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_membership_requests_updated_at on public.membership_requests;
create trigger trg_membership_requests_updated_at
  before update on public.membership_requests
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 5. Helper de autorización
-- SECURITY DEFINER evita recursión infinita cuando las policies de profiles
-- consultan profiles para chequear el rol.
-- -----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, anon;

-- -----------------------------------------------------------------------------
-- 6. Habilitar RLS
-- -----------------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.membership_requests enable row level security;

-- -----------------------------------------------------------------------------
-- 7. Policies: profiles
-- -----------------------------------------------------------------------------
drop policy if exists "profiles_select_self_or_admin" on public.profiles;
create policy "profiles_select_self_or_admin"
  on public.profiles for select
  to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_update_self_limited" on public.profiles;
create policy "profiles_update_self_limited"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    -- Un usuario NO puede cambiar su propio rol ni su documento.
    and role = (select role from public.profiles where id = auth.uid())
    and identity_document = (select identity_document from public.profiles where id = auth.uid())
  );

drop policy if exists "profiles_update_admin_all" on public.profiles;
create policy "profiles_update_admin_all"
  on public.profiles for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- INSERT y DELETE solo vía service_role (API routes con admin client).
-- service_role bypasea RLS por defecto, así que no se necesita policy.

-- -----------------------------------------------------------------------------
-- 8. Policies: membership_requests
-- -----------------------------------------------------------------------------
drop policy if exists "requests_insert_public" on public.membership_requests;
create policy "requests_insert_public"
  on public.membership_requests for insert
  to anon, authenticated
  with check (true);

drop policy if exists "requests_select_admin" on public.membership_requests;
create policy "requests_select_admin"
  on public.membership_requests for select
  to authenticated
  using (public.is_admin());

drop policy if exists "requests_update_admin" on public.membership_requests;
create policy "requests_update_admin"
  on public.membership_requests for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "requests_delete_admin" on public.membership_requests;
create policy "requests_delete_admin"
  on public.membership_requests for delete
  to authenticated
  using (public.is_admin());
