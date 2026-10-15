-- =============================================================================
-- Módulo de cuentas de banco y métodos de pago
--
-- 1. Cuentas bancarias (`bank_accounts`): donde los accionistas pueden
--    depositar dinero.
--    - id              : uuid primary key default gen_random_uuid()
--    - bank_name       : text not null (e.g., 'Bancolombia')
--    - account_type    : text not null check (account_type in ('ahorros', 'corriente'))
--    - holder_name     : text not null
--    - account_number  : text not null
--    - qr_path         : text (ruta en storage de la imagen de QR, nullable)
--    - is_active       : boolean not null default true
--    - created_at      : timestamptz not null default now()
--    - updated_at      : timestamptz not null default now()
--
-- 2. Cambios en `receipts`:
--    - `payment_method`: enum/check 'transfer' o 'cash'.
--    - `bank_account_id`: FK a `bank_accounts(id)` on delete set null.
--
-- 3. Storage bucket `bank-qrs`:
--    - Almacenar los códigos QR subidos por el administrador.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Crear tabla bank_accounts
-- -----------------------------------------------------------------------------
create table if not exists public.bank_accounts (
  id              uuid primary key default gen_random_uuid(),
  bank_name       text not null,
  account_type    text not null check (account_type in ('ahorros', 'corriente')),
  holder_name     text not null,
  account_number  text not null,
  qr_path         text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Trigger updated_at para bank_accounts
drop trigger if exists trg_bank_accounts_updated_at on public.bank_accounts;
create trigger trg_bank_accounts_updated_at
  before update on public.bank_accounts
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. Agregar columnas a receipts
-- -----------------------------------------------------------------------------
alter table public.receipts
  add column if not exists payment_method text check (payment_method in ('transfer', 'cash')) default 'transfer',
  add column if not exists bank_account_id uuid references public.bank_accounts (id) on delete set null;

-- -----------------------------------------------------------------------------
-- 3. RLS para bank_accounts
-- -----------------------------------------------------------------------------
alter table public.bank_accounts enable row level security;

drop policy if exists "bank_accounts_select_authenticated" on public.bank_accounts;
create policy "bank_accounts_select_authenticated"
  on public.bank_accounts for select
  to authenticated
  using (true);

drop policy if exists "bank_accounts_admin_all" on public.bank_accounts;
create policy "bank_accounts_admin_all"
  on public.bank_accounts for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- 4. Storage bucket para códigos QR
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bank-qrs',
  'bank-qrs',
  true,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png']
)
on conflict (id) do update
  set file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public             = excluded.public;

-- Policies sobre storage.objects para bank-qrs
drop policy if exists "bank_qrs_select" on storage.objects;
create policy "bank_qrs_select"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'bank-qrs');

drop policy if exists "bank_qrs_admin_all" on storage.objects;
create policy "bank_qrs_admin_all"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'bank-qrs' and public.is_admin())
  with check (bucket_id = 'bank-qrs' and public.is_admin());

-- -----------------------------------------------------------------------------
-- 5. Realtime: suscribir bank_accounts
-- -----------------------------------------------------------------------------
do $$ begin
  execute 'alter publication supabase_realtime add table public.bank_accounts';
exception when duplicate_object then null;
end $$;
