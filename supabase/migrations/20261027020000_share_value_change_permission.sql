-- =============================================================================
-- Cambio del valor de la acción con permiso del admin (RN-2.2).
--
-- Contexto:
--   - Cris redefinió la RN-2.2 el 2026-10-27: el accionista puede cambiar el
--     valor solo si todavía no ha comprado acciones en el periodo y el admin
--     le habilitó el cambio. Desde que envía el primer recibo con acciones
--     (pendiente o aprobado) el valor queda fijo hasta el próximo periodo, sin
--     excepción.
--   - 20261027000000 bloqueaba el valor apenas se elegía.
--
-- Qué hace:
--   1. Agrega period_memberships.share_value_change_allowed (permiso de un
--      solo cambio).
--   2. Agrega has_share_receipts_in_period: hay un recibo pendiente o
--      aprobado con acciones de algún mes del año del periodo.
--   3. Reemplaza el trigger: un valor elegido solo cambia con el permiso y sin
--      recibos de acciones; el permiso se consume al usarlo; repetir el mismo
--      valor no reescribe share_value_locked_at.
--   4. Agrega la RPC allow_share_value_change, solo para el admin.
-- =============================================================================

-- 1. Permiso de un solo cambio.
alter table public.period_memberships
  add column share_value_change_allowed boolean not null default false;

-- 2. ¿Ya envió un recibo con acciones en el periodo?
create or replace function public.has_share_receipts_in_period(p_profile_id uuid, p_period_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
      from public.receipts r
      join public.receipt_items i on i.receipt_id = r.id
      join public.periods per on per.id = p_period_id
     where r.user_id = p_profile_id
       and r.status in ('pending', 'approved')
       and i.concept = 'acciones'
       and extract(year from i.target_month)::int = per.year
  );
$$;

revoke all on function public.has_share_receipts_in_period(uuid, uuid) from public;

-- 3. Protección del valor.
create or replace function public.enforce_period_share_value()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.share_value is not null then
    if new.share_value is not distinct from old.share_value then
      -- Repetir el mismo valor no cambia la fecha del bloqueo.
      new.share_value_locked_at := old.share_value_locked_at;
    else
      if public.has_share_receipts_in_period(old.profile_id, old.period_id) then
        raise exception 'share_value_locked_by_purchase'
          using hint = 'Ya hay un recibo con acciones en el periodo (RN-2.2).';
      end if;
      if not old.share_value_change_allowed then
        raise exception 'share_value_locked'
          using hint = 'El administrador debe habilitar el cambio (RN-2.2).';
      end if;
      -- El permiso sirve para un solo cambio.
      new.share_value_change_allowed := false;
      new.share_value_locked_at := now();
    end if;
  end if;

  if new.share_value is not null
     and (tg_op = 'INSERT' or new.share_value is distinct from old.share_value)
     and not exists (
       select 1 from public.periods where id = new.period_id and status = 'open'
     ) then
    raise exception 'period_not_open'
      using hint = 'El valor de la acción solo se elige mientras el periodo está abierto.';
  end if;
  return new;
end;
$$;

-- 4. El admin habilita (o revoca) un cambio para un accionista en el periodo
--    abierto.
create or replace function public.allow_share_value_change(p_profile_id uuid, p_allow boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_id uuid;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;

  select id into v_period_id from public.periods where status = 'open';
  if v_period_id is null then
    raise exception 'period_not_open'
      using hint = 'El valor de la acción solo se elige mientras el periodo está abierto.';
  end if;

  if p_allow and public.has_share_receipts_in_period(p_profile_id, v_period_id) then
    raise exception 'share_value_locked_by_purchase'
      using hint = 'Ya hay un recibo con acciones en el periodo (RN-2.2).';
  end if;

  update public.period_memberships
     set share_value_change_allowed = p_allow
   where profile_id = p_profile_id
     and period_id = v_period_id
     and share_value is not null;

  if not found then
    raise exception 'share_value_not_chosen'
      using hint = 'El accionista todavía no eligió el valor de su acción.';
  end if;

  return p_allow;
end;
$$;

revoke all on function public.allow_share_value_change(uuid, boolean) from public;
grant execute on function public.allow_share_value_change(uuid, boolean) to authenticated;
