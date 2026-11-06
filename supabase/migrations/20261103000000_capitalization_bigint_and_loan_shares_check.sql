-- =============================================================================
-- Montos de capitalización en bigint y CHECK de acciones por préstamo.
--
-- Contexto:
--   - 20261026000000 pasó capitalization_windows.max_amount a bigint, pero
--     open_capitalization_window_v2(p_max_amount numeric) y
--     open_capitalization_window(p_target_amount numeric) siguen recibiendo
--     numeric: un monto con centavos se redondeaba en silencio al guardarse
--     (hallazgo A1 de la revisión de la S2).
--   - loans.loan_shares_amount es loan_shares_count × valor de acción
--     (RN-4.14), pero nada impedía guardar un monto que no fuera múltiplo de
--     la cantidad de acciones.
--
-- Qué hace (todo en una transacción):
--   1. Aborta si algún préstamo tiene un loan_shares_amount que no es
--      múltiplo de loan_shares_count, o un monto sin acciones. Nunca se
--      corrige en silencio: si falla, hay que corregir esos datos a mano.
--   2. Borra las dos funciones con parámetros numeric y las recrea con
--      parámetros bigint (una sola firma cada una), con el mismo cuerpo, la
--      misma seguridad (SECURITY DEFINER, search_path = public) y EXECUTE
--      solo para authenticated. Un monto con centavos ahora falla al llamar
--      ("invalid input syntax for type bigint") en vez de redondearse.
--   3. Agrega el CHECK loans_loan_shares_amount_multiple.
-- =============================================================================

-- 1. Precondición: acciones por préstamo coherentes.
do $$
declare
  v_filas bigint;
begin
  select count(*) into v_filas
    from public.loans
   where (loan_shares_count > 0 and loan_shares_amount % loan_shares_count <> 0)
      or (loan_shares_count = 0 and loan_shares_amount <> 0);
  if v_filas > 0 then
    raise exception 'Hay % préstamos cuyo loan_shares_amount no es múltiplo de loan_shares_count. Corrígelos antes de agregar el CHECK.',
      v_filas;
  end if;
end;
$$;

-- 2. Funciones con montos bigint.
drop function public.open_capitalization_window(numeric, date);
drop function public.open_capitalization_window_v2(text, uuid, numeric, date);

create function public.open_capitalization_window(
  p_target_amount bigint,
  p_deadline date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'America/Bogota')::date;
begin
  if not public.is_admin() then
    raise exception 'forbidden'
      using hint = 'Solo el administrador puede abrir la ventana de capitalizaciones.';
  end if;

  if p_target_amount is null or p_target_amount <= 0 then
    raise exception 'invalid_target_amount'
      using hint = 'El monto objetivo debe ser mayor a cero.';
  end if;

  if p_deadline is null then
    raise exception 'invalid_deadline'
      using hint = 'Debes indicar una fecha límite.';
  end if;

  if p_deadline < v_today then
    raise exception 'invalid_deadline'
      using hint = 'La fecha límite no puede ser anterior a hoy.';
  end if;

  insert into public.system_settings (key, value)
  values (
    'capitalization_window',
    jsonb_build_object(
      'enabled', true,
      'target_amount', p_target_amount,
      'deadline', p_deadline,
      'opened_at', now(),
      'closed_manually', false
    )
  )
  on conflict (key) do update
    set value = excluded.value,
        updated_at = now();

  return public.get_capitalization_window_state();
end;
$$;

revoke all on function public.open_capitalization_window(bigint, date) from public, anon;
grant execute on function public.open_capitalization_window(bigint, date)
  to authenticated;

create function public.open_capitalization_window_v2(
  p_scope      text,
  p_user_id    uuid,
  p_max_amount bigint,
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

revoke all on function public.open_capitalization_window_v2(text, uuid, bigint, date) from public, anon;
grant execute on function public.open_capitalization_window_v2(text, uuid, bigint, date)
  to authenticated;

-- 3. CHECK: el monto de acciones por préstamo es múltiplo de la cantidad.
alter table public.loans
  add constraint loans_loan_shares_amount_multiple check (
    (loan_shares_count > 0 and loan_shares_amount % loan_shares_count = 0)
    or (loan_shares_count = 0 and loan_shares_amount = 0)
  );
