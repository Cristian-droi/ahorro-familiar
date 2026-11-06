-- =============================================================================
-- Periodos y valor de acción por periodo (RN-2.2, decisión D6 de
-- docs/modelo-datos.md, secciones 4.1 y 4.2).
--
-- Contexto:
--   - RN-2.2: el valor de la acción se elige una sola vez por periodo, al
--     iniciar el año, y no se puede cambiar a mitad de año. Cris pidió quitar
--     el desbloqueo del admin (2026-10-27): no hay excepción.
--   - Hoy el valor vive en profiles.selected_share_value, con el flag
--     share_value_change_allowed y dos triggers que el admin podía saltarse.
--
-- Qué hace (todo en una transacción):
--   1. Crea el enum period_status y las tablas periods y period_memberships.
--   2. Abre el periodo del año en curso (America/Bogota) y copia en
--      period_memberships el valor que cada perfil ya tenía, bloqueado.
--   3. Protege en la base que un valor elegido nunca cambie (sin excepción
--      para el admin) y que solo se elija con el periodo abierto.
--   4. Agrega la RPC choose_share_value, que el caso de uso llama después de
--      validar con el dominio (elegirValorDeAccion).
--   5. Borra los triggers del bloqueo legado y las columnas
--      selected_share_value y share_value_change_allowed de profiles.
--
-- No toca profiles.next_year_capitalization: su lugar en period_memberships
-- no está definido en el modelo de datos.
-- =============================================================================

-- 1. Tipos y tablas.
create type public.period_status as enum ('open', 'closing', 'closed');

create table public.periods (
  id uuid primary key default gen_random_uuid(),
  year int not null unique,
  status public.period_status not null default 'open',
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opened_by uuid references public.profiles (id),
  closed_by uuid references public.profiles (id)
);

-- Un solo periodo abierto a la vez.
create unique index periods_one_open on public.periods (status) where status = 'open';

create table public.period_memberships (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  period_id uuid not null references public.periods (id),
  -- Null: todavía no eligió y no puede comprar (RN-2.3). Los valores
  -- permitidos los valida el caso de uso (RN-2.1).
  share_value bigint check (share_value > 0),
  share_value_locked_at timestamptz,
  primary key (profile_id, period_id),
  constraint period_memberships_lock_shape
    check ((share_value is null) = (share_value_locked_at is null))
);

-- 2. Periodo del año en curso y valores ya elegidos.
insert into public.periods (year, status)
values (extract(year from (now() at time zone 'America/Bogota'))::int, 'open');

insert into public.period_memberships (profile_id, period_id, share_value, share_value_locked_at)
select p.id,
       per.id,
       p.selected_share_value,
       case when p.selected_share_value is not null then now() end
  from public.profiles p
 cross join public.periods per
 where per.status = 'open';

-- 3. Protección: el valor elegido nunca cambia, ni siquiera por el admin, y
--    solo se elige con el periodo abierto.
create or replace function public.enforce_period_share_value()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.share_value is not null
     and new.share_value is distinct from old.share_value then
    raise exception 'share_value_locked'
      using hint = 'El valor de la acción se elige una sola vez por periodo (RN-2.2).';
  end if;
  if new.share_value is not null
     and (tg_op = 'INSERT' or old.share_value is null)
     and not exists (
       select 1 from public.periods where id = new.period_id and status = 'open'
     ) then
    raise exception 'period_not_open'
      using hint = 'El valor de la acción solo se elige mientras el periodo está abierto.';
  end if;
  return new;
end;
$$;

-- El backfill de arriba ya corrió, así que el trigger solo cubre lo nuevo.
create trigger trg_enforce_period_share_value
  before insert or update on public.period_memberships
  for each row execute function public.enforce_period_share_value();

-- 4. RPC para elegir el valor del periodo abierto. El dominio ya validó el
--    valor; la base protege el bloqueo con el trigger.
create or replace function public.choose_share_value(p_share_value bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select id into v_period_id from public.periods where status = 'open';
  if v_period_id is null then
    raise exception 'period_not_open'
      using hint = 'El valor de la acción solo se elige mientras el periodo está abierto.';
  end if;

  insert into public.period_memberships (profile_id, period_id, share_value, share_value_locked_at)
  values (auth.uid(), v_period_id, p_share_value, now())
  on conflict (profile_id, period_id) do update
    set share_value = excluded.share_value,
        share_value_locked_at = excluded.share_value_locked_at;

  return p_share_value;
end;
$$;

revoke all on function public.choose_share_value(bigint) from public;
grant execute on function public.choose_share_value(bigint) to authenticated;

-- Lectura: cada uno ve su membresía y el admin ve todas. Nadie escribe
-- directo desde el cliente.
alter table public.periods enable row level security;
alter table public.period_memberships enable row level security;

grant select on public.periods to authenticated;
grant select on public.period_memberships to authenticated;

create policy periods_select_authenticated on public.periods
  for select to authenticated using (true);

create policy period_memberships_select_own_or_admin on public.period_memberships
  for select to authenticated using (profile_id = auth.uid() or public.is_admin());

-- 5. Fuera el bloqueo legado y las columnas viejas.
drop trigger if exists trg_enforce_share_value_lock on public.profiles;
drop function if exists public.enforce_share_value_lock();
drop trigger if exists trg_receipts_lock_share_value on public.receipts;
drop function if exists public.lock_share_value_on_approval();

alter table public.profiles drop column selected_share_value;
alter table public.profiles drop column share_value_change_allowed;
