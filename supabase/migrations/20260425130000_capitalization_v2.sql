-- =============================================================================
-- Capitalizaciones v2 — ventanas individuales (por accionista) y global.
--
-- Modelo nuevo:
--   - Una sola tabla `capitalization_windows` con scope = 'global' | 'user'.
--   - Global: deadline obligatoria, sin tope de monto. Aplica a todos los
--     accionistas que NO tengan ventana individual activa.
--   - User: user_id obligatorio, max_amount > 0, deadline. Aplica solo a ese
--     accionista. ANULA la global para él.
--   - Máximo 1 ventana global activa y 1 por accionista.
--   - Al alcanzar el monto máximo (en una user-window) o al pasar la deadline,
--     la ventana se cierra automáticamente cuando alguien consulte estado.
--
-- Compat: la entrada en `system_settings.capitalization_window` queda
-- deprecada. Si tiene `enabled=true` y deadline en el futuro, la migramos
-- a una fila global activa para no perder el estado.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tabla
-- -----------------------------------------------------------------------------
create table if not exists public.capitalization_windows (
  id            uuid primary key default gen_random_uuid(),
  scope         text not null check (scope in ('global', 'user')),
  user_id       uuid references auth.users(id) on delete cascade,
  max_amount    numeric,
  deadline      date not null,
  opened_at     timestamptz not null default now(),
  opened_by     uuid references auth.users(id),
  closed_at     timestamptz,
  closed_reason text,
  created_at    timestamptz not null default now(),

  constraint scope_user_consistent check (
    (scope = 'global' and user_id is null and max_amount is null) or
    (scope = 'user'   and user_id is not null and max_amount > 0)
  )
);

-- Solo una global activa a la vez.
create unique index if not exists uq_active_global_capwindow
  on public.capitalization_windows ((scope))
  where scope = 'global' and closed_at is null;

-- Solo una por accionista activa a la vez.
create unique index if not exists uq_active_user_capwindow
  on public.capitalization_windows (user_id)
  where scope = 'user' and closed_at is null;

-- Índice para lookups rápidos por user (incluyendo cerradas, para historial).
create index if not exists ix_capwindows_user
  on public.capitalization_windows (user_id, opened_at desc)
  where scope = 'user';

-- -----------------------------------------------------------------------------
-- 2. RLS — solo admin lee/escribe. Los accionistas usan get_my_capitalization_state.
-- -----------------------------------------------------------------------------
alter table public.capitalization_windows enable row level security;

drop policy if exists capwindows_admin_all on public.capitalization_windows;
create policy capwindows_admin_all on public.capitalization_windows
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- 3. Migración del estado actual de system_settings → fila global
-- -----------------------------------------------------------------------------
do $$
declare
  v_settings jsonb;
  v_enabled  boolean;
  v_deadline date;
begin
  select value into v_settings
    from public.system_settings
   where key = 'capitalization_window';

  if v_settings is null then return; end if;

  v_enabled  := coalesce((v_settings->>'enabled')::boolean, false);
  v_deadline := nullif(v_settings->>'deadline', '')::date;

  if v_enabled
     and v_deadline is not null
     and v_deadline >= (now() at time zone 'America/Bogota')::date
     and not exists (
       select 1 from public.capitalization_windows
        where scope = 'global' and closed_at is null
     )
  then
    insert into public.capitalization_windows (scope, deadline, opened_at)
    values ('global', v_deadline, now());
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 4. RPC: open_capitalization_window_v2
-- -----------------------------------------------------------------------------
create or replace function public.open_capitalization_window_v2(
  p_scope      text,
  p_user_id    uuid,
  p_max_amount numeric,
  p_deadline   date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid;
  v_today date := (now() at time zone 'America/Bogota')::date;
begin
  if not public.is_admin() then
    raise exception 'forbidden'
      using hint = 'Solo el administrador puede abrir ventanas de capitalización.';
  end if;

  if p_deadline is null then
    raise exception 'invalid_deadline'
      using hint = 'Debes indicar una fecha límite.';
  end if;

  if p_deadline < v_today then
    raise exception 'invalid_deadline'
      using hint = 'La fecha límite no puede ser anterior a hoy.';
  end if;

  if p_scope not in ('global', 'user') then
    raise exception 'invalid_scope'
      using hint = 'scope debe ser ''global'' o ''user''.';
  end if;

  if p_scope = 'global' then
    -- Cerrar la global activa anterior (si existe) — la reemplazamos.
    update public.capitalization_windows
       set closed_at = now(), closed_reason = 'replaced'
     where scope = 'global' and closed_at is null;

    insert into public.capitalization_windows
      (scope, deadline, opened_by)
    values ('global', p_deadline, auth.uid())
    returning id into v_id;
  else
    -- p_scope = 'user'
    if p_user_id is null then
      raise exception 'invalid_user'
        using hint = 'Debes indicar el accionista.';
    end if;

    if p_max_amount is null or p_max_amount <= 0 then
      raise exception 'invalid_max_amount'
        using hint = 'El monto máximo debe ser mayor a cero.';
    end if;

    -- Cerrar la activa de ese accionista (si existe).
    update public.capitalization_windows
       set closed_at = now(), closed_reason = 'replaced'
     where scope = 'user' and user_id = p_user_id and closed_at is null;

    insert into public.capitalization_windows
      (scope, user_id, max_amount, deadline, opened_by)
    values ('user', p_user_id, p_max_amount, p_deadline, auth.uid())
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.open_capitalization_window_v2(text, uuid, numeric, date) from public;
grant execute on function public.open_capitalization_window_v2(text, uuid, numeric, date)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 5. RPC: close_capitalization_window_v2
-- -----------------------------------------------------------------------------
create or replace function public.close_capitalization_window_v2(p_window_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  update public.capitalization_windows
     set closed_at     = now(),
         closed_reason = 'manual'
   where id = p_window_id
     and closed_at is null;
end;
$$;

revoke all on function public.close_capitalization_window_v2(uuid) from public;
grant execute on function public.close_capitalization_window_v2(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. RPC: get_my_capitalization_state
--
-- Devuelve el estado de capitalización del accionista autenticado:
--   { allowed, scope, max_amount, used, remaining, deadline, window_id }
-- - Si tiene una ventana 'user' activa y vigente → la usa (anula la global).
-- - Si no, intenta la global activa y vigente.
-- - Si nada aplica, allowed=false.
-- Auto-cierra ventanas vencidas o con monto agotado al detectarlo.
-- -----------------------------------------------------------------------------
create or replace function public.get_my_capitalization_state()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_today     date := (now() at time zone 'America/Bogota')::date;
  v_user_w    public.capitalization_windows%rowtype;
  v_global_w  public.capitalization_windows%rowtype;
  v_used      numeric := 0;
  v_remaining numeric := 0;
begin
  if v_uid is null then
    return jsonb_build_object('allowed', false, 'reason', 'unauthenticated');
  end if;

  -- 1. Buscar ventana individual activa.
  select * into v_user_w
    from public.capitalization_windows
   where scope = 'user' and user_id = v_uid and closed_at is null
   order by opened_at desc
   limit 1;

  if v_user_w.id is not null then
    if v_user_w.deadline < v_today then
      update public.capitalization_windows
         set closed_at = now(), closed_reason = 'deadline_passed'
       where id = v_user_w.id;
    else
      -- Calcular lo ya capitalizado por este user dentro de esta ventana.
      select coalesce(sum(ri.amount), 0)
        into v_used
        from public.receipt_items ri
        join public.receipts r on r.id = ri.receipt_id
       where ri.concept = 'capitalizacion'
         and r.user_id = v_uid
         and r.status in ('pending', 'approved')
         and r.created_at >= v_user_w.opened_at;

      v_remaining := greatest(v_user_w.max_amount - v_used, 0);
      if v_remaining <= 0 then
        update public.capitalization_windows
           set closed_at = now(), closed_reason = 'amount_reached'
         where id = v_user_w.id;
      else
        return jsonb_build_object(
          'allowed',     true,
          'scope',       'user',
          'window_id',   v_user_w.id,
          'max_amount',  v_user_w.max_amount,
          'used',        v_used,
          'remaining',   v_remaining,
          'deadline',    v_user_w.deadline
        );
      end if;
    end if;
  end if;

  -- 2. Si no hay user-window válida, buscar global.
  select * into v_global_w
    from public.capitalization_windows
   where scope = 'global' and closed_at is null
   order by opened_at desc
   limit 1;

  if v_global_w.id is not null then
    if v_global_w.deadline < v_today then
      update public.capitalization_windows
         set closed_at = now(), closed_reason = 'deadline_passed'
       where id = v_global_w.id;
    else
      return jsonb_build_object(
        'allowed',    true,
        'scope',      'global',
        'window_id',  v_global_w.id,
        'max_amount', null,
        'used',       null,
        'remaining',  null,
        'deadline',   v_global_w.deadline
      );
    end if;
  end if;

  return jsonb_build_object('allowed', false, 'reason', 'no_active_window');
end;
$$;

revoke all on function public.get_my_capitalization_state() from public;
grant execute on function public.get_my_capitalization_state()
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 7. RPC: get_capitalization_windows_admin
--
-- Para el dashboard admin: lista todas las ventanas activas con su uso
-- actual. Las ventanas individuales reportan used/remaining; la global no.
-- -----------------------------------------------------------------------------
create or replace function public.get_capitalization_windows_admin()
returns table (
  id            uuid,
  scope         text,
  user_id       uuid,
  user_name     text,
  user_document text,
  max_amount    numeric,
  used_amount   numeric,
  remaining     numeric,
  deadline      date,
  opened_at     timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  return query
  with active as (
    select w.*
      from public.capitalization_windows w
     where w.closed_at is null
  ),
  used_by_user as (
    select w.id as window_id,
           coalesce(sum(ri.amount), 0) as used
      from active w
      left join public.receipts r
        on (w.scope = 'global' or r.user_id = w.user_id)
       and r.status in ('pending', 'approved')
       and r.created_at >= w.opened_at
      left join public.receipt_items ri
        on ri.receipt_id = r.id
       and ri.concept = 'capitalizacion'
     where w.scope = 'user'
     group by w.id
  )
  select
    a.id,
    a.scope,
    a.user_id,
    case when p.id is not null then trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')) end as user_name,
    p.identity_document as user_document,
    a.max_amount,
    coalesce(u.used, 0) as used_amount,
    case when a.scope = 'user' then greatest(a.max_amount - coalesce(u.used, 0), 0) end as remaining,
    a.deadline,
    a.opened_at
  from active a
  left join public.profiles p on p.id = a.user_id
  left join used_by_user u on u.window_id = a.id
  order by a.scope desc, a.opened_at desc;
end;
$$;

revoke all on function public.get_capitalization_windows_admin() from public;
grant execute on function public.get_capitalization_windows_admin() to authenticated;

-- -----------------------------------------------------------------------------
-- 8. Trigger validate_receipt_item_capitalization — actualizado al modelo v2
--
-- Verifica que exista una ventana válida para el accionista del recibo y que
-- el monto cabe dentro del remaining (cuando es individual).
-- -----------------------------------------------------------------------------
create or replace function public.validate_receipt_item_capitalization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today      date := (now() at time zone 'America/Bogota')::date;
  v_current_m  date := date_trunc('month', v_today)::date;
  v_user_id    uuid;
  v_user_w     public.capitalization_windows%rowtype;
  v_global_w   public.capitalization_windows%rowtype;
  v_used       numeric := 0;
  v_remaining  numeric;
begin
  if new.concept <> 'capitalizacion' then
    return new;
  end if;

  if new.share_count is not null then
    raise exception 'capitalization_has_shares'
      using hint = 'La capitalización no maneja cantidad de acciones.';
  end if;
  if new.unit_value is not null then
    raise exception 'capitalization_has_unit_value'
      using hint = 'La capitalización no maneja valor unitario.';
  end if;
  if new.amount is null or new.amount <= 0 then
    raise exception 'capitalization_invalid_amount'
      using hint = 'El monto de la capitalización debe ser mayor a cero.';
  end if;
  if new.target_month <> v_current_m then
    raise exception 'capitalization_target_month_invalid'
      using hint = 'La capitalización debe asociarse al mes actual.';
  end if;

  -- Necesitamos saber a qué accionista pertenece el recibo.
  select user_id into v_user_id
    from public.receipts
   where id = new.receipt_id;

  if v_user_id is null then
    raise exception 'capitalization_receipt_not_found';
  end if;

  -- 1. ¿Tiene ventana individual activa y vigente?
  select * into v_user_w
    from public.capitalization_windows
   where scope = 'user' and user_id = v_user_id and closed_at is null
     and deadline >= v_today
   order by opened_at desc
   limit 1;

  if v_user_w.id is not null then
    select coalesce(sum(ri.amount), 0)
      into v_used
      from public.receipt_items ri
      join public.receipts r on r.id = ri.receipt_id
     where ri.concept = 'capitalizacion'
       and r.user_id = v_user_id
       and r.status in ('pending', 'approved')
       and r.created_at >= v_user_w.opened_at
       and ri.id <> new.id;  -- excluir esta misma fila si es UPDATE

    v_remaining := v_user_w.max_amount - v_used;
    if new.amount > v_remaining then
      raise exception 'capitalization_exceeds_max'
        using hint = format(
          'El monto excede tu cupo de capitalización (disponible: %s).',
          v_remaining
        );
    end if;
    return new;
  end if;

  -- 2. Si no, ¿hay global activa y vigente?
  select * into v_global_w
    from public.capitalization_windows
   where scope = 'global' and closed_at is null
     and deadline >= v_today
   order by opened_at desc
   limit 1;

  if v_global_w.id is not null then
    return new;  -- global no tiene tope individual
  end if;

  raise exception 'capitalization_window_closed'
    using hint = 'No hay ninguna ventana de capitalización abierta para este accionista.';
end;
$$;

-- (El trigger ya existe; CREATE OR REPLACE FUNCTION basta.)

-- -----------------------------------------------------------------------------
-- 9. Realtime: que el header del accionista pueda reaccionar a cambios.
-- -----------------------------------------------------------------------------
do $$ begin
  execute 'alter publication supabase_realtime add table public.capitalization_windows';
exception when duplicate_object then null;
end $$;
