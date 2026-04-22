-- =============================================================================
-- Módulo de compra de acciones (Libro de caja)
--
-- Un "recibo" (receipts) agrupa una o más líneas (receipt_items) que el
-- accionista envía al admin para revisión. El admin aprueba o rechaza.
-- Solo los recibos aprobados cuentan en saldos, extractos y bloqueos.
--
-- Conceptos soportados por el enum (solo 'acciones' y 'multa_acciones' se usan
-- por ahora; los demás existen para que el esquema no tenga que migrar cuando
-- se agreguen los módulos correspondientes):
--   acciones            — aporte mensual de acciones (el mínimo/máximo aplica)
--   acciones_prestamo   — acciones financiadas con préstamo
--   pago_capital        — abono a capital de un préstamo
--   pago_intereses      — pago de intereses
--   capitalizacion      — capitalización libre
--   multa_acciones      — multa auto-calculada por mora en compra de acciones
--   otros               — placeholder para futuros conceptos
--
-- Reglas forzadas por triggers:
--   - Numeración global secuencial RC-00001.
--   - `receipts.total_amount` = sum(receipt_items.amount) siempre.
--   - `target_month` debe ser el primer día del mes y, para concepto 'acciones',
--     debe estar entre el mes actual (America/Bogota) y diciembre del año
--     en curso.
--   - No exceder max_shares_per_month por (user, target_month) sumando líneas
--     en estado pending + approved.
--   - Al aprobarse el primer recibo con concepto 'acciones', se bloquea
--     `share_value_change_allowed` del perfil.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Enums
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.receipt_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.receipt_rejection_reason as enum ('amount_mismatch', 'payment_not_received');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.receipt_concept as enum (
    'acciones',
    'acciones_prestamo',
    'pago_capital',
    'pago_intereses',
    'capitalizacion',
    'multa_acciones',
    'otros'
  );
exception when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Secuencia global de recibos
-- -----------------------------------------------------------------------------
create sequence if not exists public.receipt_number_seq
  start with 1 increment by 1 minvalue 1 no maxvalue cache 1;

-- -----------------------------------------------------------------------------
-- 3. Tabla receipts
-- -----------------------------------------------------------------------------
create table if not exists public.receipts (
  id                  uuid primary key default gen_random_uuid(),
  receipt_number      text unique,
  user_id             uuid not null references auth.users (id) on delete cascade,
  status              public.receipt_status not null default 'pending',
  submitted_at        timestamptz not null default now(),
  reviewed_at         timestamptz,
  reviewed_by         uuid references auth.users (id) on delete set null,
  rejection_reason    public.receipt_rejection_reason,
  rejection_note      text,
  payment_proof_path  text,
  total_amount        numeric(14, 2) not null default 0 check (total_amount >= 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Un recibo rechazado/pendiente puede no tener fecha de revisión; uno
  -- revisado debe tenerla.
  constraint receipts_reviewed_consistency check (
    (status = 'pending' and reviewed_at is null and reviewed_by is null
       and rejection_reason is null and rejection_note is null)
    or (status = 'approved' and reviewed_at is not null and reviewed_by is not null
       and rejection_reason is null)
    or (status = 'rejected' and reviewed_at is not null and reviewed_by is not null
       and rejection_reason is not null)
  )
);

create index if not exists idx_receipts_user_status
  on public.receipts (user_id, status, submitted_at desc);

create index if not exists idx_receipts_status_submitted
  on public.receipts (status, submitted_at desc);

-- -----------------------------------------------------------------------------
-- 4. Tabla receipt_items
-- -----------------------------------------------------------------------------
create table if not exists public.receipt_items (
  id              uuid primary key default gen_random_uuid(),
  receipt_id      uuid not null references public.receipts (id) on delete cascade,
  concept         public.receipt_concept not null,
  target_month    date not null,
  share_count     integer check (share_count is null or share_count > 0),
  unit_value      numeric(14, 2) check (unit_value is null or unit_value > 0),
  amount          numeric(14, 2) not null check (amount >= 0),
  auto_generated  boolean not null default false,
  created_at      timestamptz not null default now(),
  -- Para concepto 'acciones' exigimos share_count * unit_value = amount.
  constraint receipt_items_acciones_shape check (
    concept <> 'acciones'
    or (share_count is not null
        and unit_value is not null
        and amount = (share_count::numeric * unit_value))
  ),
  -- Las multas son siempre auto-generadas; los demás conceptos nunca lo son.
  constraint receipt_items_multa_autogen check (
    (concept = 'multa_acciones' and auto_generated = true)
    or (concept <> 'multa_acciones' and auto_generated = false)
  ),
  -- target_month debe ser el primer día del mes.
  constraint receipt_items_target_month_first_day check (
    target_month = date_trunc('month', target_month)::date
  )
);

create index if not exists idx_receipt_items_receipt
  on public.receipt_items (receipt_id);

create index if not exists idx_receipt_items_user_month
  on public.receipt_items (concept, target_month);

-- -----------------------------------------------------------------------------
-- 5. Trigger: asignar receipt_number al insertar
-- -----------------------------------------------------------------------------
create or replace function public.assign_receipt_number()
returns trigger
language plpgsql
as $$
begin
  if new.receipt_number is null or new.receipt_number = '' then
    new.receipt_number := 'RC-' || lpad(nextval('public.receipt_number_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_receipts_assign_number on public.receipts;
create trigger trg_receipts_assign_number
  before insert on public.receipts
  for each row execute function public.assign_receipt_number();

-- Trigger updated_at (reusa set_updated_at de la migración base).
drop trigger if exists trg_receipts_updated_at on public.receipts;
create trigger trg_receipts_updated_at
  before update on public.receipts
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 6. Trigger: validar target_month contra año en curso (solo 'acciones')
-- -----------------------------------------------------------------------------
create or replace function public.validate_receipt_item_target_month()
returns trigger
language plpgsql
as $$
declare
  v_today        date := (now() at time zone 'America/Bogota')::date;
  v_current_m    date := date_trunc('month', v_today)::date;
  v_year_end_m   date := (date_trunc('year', v_today) + interval '11 months')::date;
begin
  -- Reglas duras solo para concepto 'acciones'. Otros conceptos mantienen
  -- target_month como referencia contable sin restricción de rango.
  if new.concept = 'acciones' then
    if new.target_month < v_current_m then
      raise exception 'target_month_past'
        using hint = 'No puedes comprar acciones para meses anteriores al actual.';
    end if;
    if new.target_month > v_year_end_m then
      raise exception 'target_month_next_year'
        using hint = 'Solo puedes comprar acciones hasta diciembre del año en curso.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_receipt_items_validate_month on public.receipt_items;
create trigger trg_receipt_items_validate_month
  before insert or update of target_month, concept on public.receipt_items
  for each row execute function public.validate_receipt_item_target_month();

-- -----------------------------------------------------------------------------
-- 7. Trigger: enforzar max_shares_per_month
--
-- Cuenta líneas de concepto 'acciones' del usuario dueño del recibo para
-- el mismo target_month en estado pending+approved (ignora rejected) y
-- valida que con la nueva fila no se exceda el tope configurado.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_max_shares_per_month()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id      uuid;
  v_max_shares   integer := 10;
  v_total        integer;
  v_settings     jsonb;
begin
  if new.concept <> 'acciones' then return new; end if;
  if new.share_count is null or new.share_count <= 0 then return new; end if;

  select value into v_settings
    from public.system_settings
   where key = 'purchase_rules';

  if v_settings is not null and v_settings ? 'max_shares_per_month' then
    v_max_shares := coalesce((v_settings->>'max_shares_per_month')::integer, 10);
  end if;

  select user_id into v_user_id from public.receipts where id = new.receipt_id;

  select coalesce(sum(ri.share_count), 0)
    into v_total
    from public.receipt_items ri
    join public.receipts r on r.id = ri.receipt_id
   where r.user_id = v_user_id
     and ri.target_month = new.target_month
     and ri.concept = 'acciones'
     and r.status in ('pending', 'approved')
     and ri.id <> new.id;

  if v_total + new.share_count > v_max_shares then
    raise exception 'max_shares_per_month_exceeded'
      using hint = format(
        'Máximo %s acciones por mes. Ya tienes %s para ese mes.',
        v_max_shares, v_total
      );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_receipt_items_max_shares on public.receipt_items;
create trigger trg_receipt_items_max_shares
  before insert or update of share_count, target_month, concept on public.receipt_items
  for each row execute function public.enforce_max_shares_per_month();

-- -----------------------------------------------------------------------------
-- 8. Trigger: mantener receipts.total_amount como suma de items
-- -----------------------------------------------------------------------------
create or replace function public.recompute_receipt_total()
returns trigger
language plpgsql
as $$
declare
  v_receipt_id uuid := coalesce(new.receipt_id, old.receipt_id);
begin
  update public.receipts
     set total_amount = coalesce((
       select sum(amount) from public.receipt_items where receipt_id = v_receipt_id
     ), 0)
   where id = v_receipt_id;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_receipt_items_recompute_total on public.receipt_items;
create trigger trg_receipt_items_recompute_total
  after insert or update or delete on public.receipt_items
  for each row execute function public.recompute_receipt_total();

-- -----------------------------------------------------------------------------
-- 9. Trigger: al aprobar un recibo con concepto 'acciones' por primera vez,
--    bloquear share_value_change_allowed del perfil.
--
-- Respeta la regla: el valor de acción solo se puede cambiar si el accionista
-- aún no ha comprado acciones en el año en curso.
-- -----------------------------------------------------------------------------
create or replace function public.lock_share_value_on_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.status = 'approved'
     and old.status is distinct from 'approved'
     and exists (
       select 1 from public.receipt_items
        where receipt_id = new.id and concept = 'acciones'
     )
  then
    update public.profiles
       set share_value_change_allowed = false
     where id = new.user_id
       and share_value_change_allowed = true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_receipts_lock_share_value on public.receipts;
create trigger trg_receipts_lock_share_value
  after update of status on public.receipts
  for each row execute function public.lock_share_value_on_approval();

-- -----------------------------------------------------------------------------
-- 10. RLS
--
-- Filosofía: SELECT abierto al dueño y al admin. Mutaciones (insert/update/
-- delete) solo vía service_role desde los endpoints de la API — ningún
-- cliente autenticado puede modificar directamente.
-- -----------------------------------------------------------------------------
alter table public.receipts      enable row level security;
alter table public.receipt_items enable row level security;

drop policy if exists "receipts_select_self_or_admin" on public.receipts;
create policy "receipts_select_self_or_admin"
  on public.receipts for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "receipt_items_select_self_or_admin" on public.receipt_items;
create policy "receipt_items_select_self_or_admin"
  on public.receipt_items for select
  to authenticated
  using (
    exists (
      select 1 from public.receipts r
       where r.id = receipt_items.receipt_id
         and (r.user_id = auth.uid() or public.is_admin())
    )
  );

-- Sin policies de insert/update/delete → solo service_role puede mutar.

-- -----------------------------------------------------------------------------
-- 11. Settings: reglas de compra (con defaults)
-- -----------------------------------------------------------------------------
insert into public.system_settings (key, value)
values (
  'purchase_rules',
  jsonb_build_object(
    'min_shares_per_month', 1,
    'max_shares_per_month', 10,
    'fine_per_day', 500,
    'fine_max_per_month', 15000,
    'grace_period_days', 10
  )
)
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- 12. Storage bucket para comprobantes de pago
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-proofs',
  'payment-proofs',
  false,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'application/pdf']
)
on conflict (id) do update
  set file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public             = excluded.public;

-- Policies sobre storage.objects: el dueño lee/escribe en su propia carpeta
-- (primer segmento del path = user_id), el admin ve todo.
drop policy if exists "payment_proofs_user_read_own" on storage.objects;
create policy "payment_proofs_user_read_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "payment_proofs_user_write_own" on storage.objects;
create policy "payment_proofs_user_write_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "payment_proofs_user_update_own" on storage.objects;
create policy "payment_proofs_user_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "payment_proofs_user_delete_own" on storage.objects;
create policy "payment_proofs_user_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "payment_proofs_admin_all" on storage.objects;
create policy "payment_proofs_admin_all"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'payment-proofs' and public.is_admin())
  with check (bucket_id = 'payment-proofs' and public.is_admin());

-- -----------------------------------------------------------------------------
-- 13. Realtime: suscribir receipts + receipt_items para historial en vivo
-- -----------------------------------------------------------------------------
do $$ begin
  execute 'alter publication supabase_realtime add table public.receipts';
exception when duplicate_object then null;
end $$;

do $$ begin
  execute 'alter publication supabase_realtime add table public.receipt_items';
exception when duplicate_object then null;
end $$;
