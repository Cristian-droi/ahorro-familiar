-- =============================================================================
-- Módulo de capitalizaciones
--
-- Concepto aparte de "acciones": el accionista puede capitalizar un monto libre
-- (COP) cuando el administrador abre una "ventana de capitalización". La
-- ventana se define con un monto objetivo y una fecha límite, y se cierra
-- automáticamente cuando se alcanza cualquiera de estas tres condiciones:
--   1. El recaudo (aprobados + pendientes) llega al monto objetivo.
--   2. Se cumple la fecha límite.
--   3. El administrador la cierra manualmente.
--
-- Reglas:
--   - La capitalización SIEMPRE se asocia al mes actual (America/Bogota).
--   - No genera multa por mora.
--   - No cuenta para el tope `max_shares_per_month` (el trigger existente ya
--     ignora conceptos distintos de 'acciones').
--   - Se puede mezclar con líneas de 'acciones' en el mismo recibo.
--   - En `receipt_items` usa la columna `amount` (share_count y unit_value
--     quedan null).
--   - Si un recibo pendiente con capitalización se rechaza, su monto deja de
--     contar para el recaudo — lo que puede reabrir la ventana si aún no
--     pasó la fecha y el objetivo no se había alcanzado con otras.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Configuración inicial en system_settings
-- -----------------------------------------------------------------------------
insert into public.system_settings (key, value)
values (
  'capitalization_window',
  jsonb_build_object(
    'enabled', false,
    'target_amount', 0,
    'deadline', null,
    'opened_at', null,
    'closed_manually', false
  )
)
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- 2. get_capitalization_window_state()
--
-- Devuelve el estado derivado de la ventana: si está abierta, cuánto se ha
-- recaudado (pending + approved de la ventana actual) y por qué está cerrada
-- cuando no está abierta. Los accionistas usan esto para decidir si muestran
-- la sección de capitalización en el carrito.
--
-- Security definer: lee system_settings y receipts/receipt_items saltando RLS.
-- Es safe porque no expone información privada (solo agregados del total).
-- -----------------------------------------------------------------------------
create or replace function public.get_capitalization_window_state()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings        jsonb;
  v_enabled         boolean;
  v_target          numeric;
  v_deadline        date;
  v_opened_at       timestamptz;
  v_closed_manually boolean;
  v_today           date := (now() at time zone 'America/Bogota')::date;
  v_recaudado       numeric := 0;
  v_is_open         boolean;
  v_close_reason    text;
  v_percentage      numeric := 0;
begin
  select value into v_settings
    from public.system_settings
   where key = 'capitalization_window';

  if v_settings is null then
    return jsonb_build_object(
      'is_open', false,
      'close_reason', 'not_configured',
      'enabled', false,
      'target_amount', 0,
      'deadline', null,
      'opened_at', null,
      'closed_manually', false,
      'recaudado', 0,
      'percentage', 0
    );
  end if;

  v_enabled         := coalesce((v_settings->>'enabled')::boolean, false);
  v_target          := coalesce((v_settings->>'target_amount')::numeric, 0);
  v_deadline        := nullif(v_settings->>'deadline', '')::date;
  v_opened_at       := nullif(v_settings->>'opened_at', '')::timestamptz;
  v_closed_manually := coalesce((v_settings->>'closed_manually')::boolean, false);

  -- Recaudado: suma de amount de receipt_items con concepto 'capitalizacion'
  -- en recibos pending + approved creados desde que se abrió la ventana.
  if v_opened_at is not null then
    select coalesce(sum(ri.amount), 0)
      into v_recaudado
      from public.receipt_items ri
      join public.receipts r on r.id = ri.receipt_id
     where ri.concept = 'capitalizacion'
       and r.status in ('pending', 'approved')
       and r.created_at >= v_opened_at;
  end if;

  if not v_enabled then
    v_is_open := false;
    v_close_reason := 'disabled';
  elsif v_closed_manually then
    v_is_open := false;
    v_close_reason := 'closed_manually';
  elsif v_deadline is not null and v_today > v_deadline then
    v_is_open := false;
    v_close_reason := 'deadline_passed';
  elsif v_target > 0 and v_recaudado >= v_target then
    v_is_open := false;
    v_close_reason := 'target_reached';
  else
    v_is_open := true;
    v_close_reason := null;
  end if;

  if v_target > 0 then
    v_percentage := least(100, round((v_recaudado / v_target) * 100, 2));
  end if;

  return jsonb_build_object(
    'is_open', v_is_open,
    'close_reason', v_close_reason,
    'enabled', v_enabled,
    'target_amount', v_target,
    'deadline', v_deadline,
    'opened_at', v_opened_at,
    'closed_manually', v_closed_manually,
    'recaudado', v_recaudado,
    'percentage', v_percentage
  );
end;
$$;

revoke all on function public.get_capitalization_window_state() from public;
grant execute on function public.get_capitalization_window_state()
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. open_capitalization_window(p_target_amount numeric, p_deadline date)
--
-- Solo admin. Abre una ventana nueva: resetea `opened_at`, `closed_manually`
-- y actualiza objetivo / fecha.
-- -----------------------------------------------------------------------------
create or replace function public.open_capitalization_window(
  p_target_amount numeric,
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

revoke all on function public.open_capitalization_window(numeric, date) from public;
grant execute on function public.open_capitalization_window(numeric, date)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 4. close_capitalization_window()
--
-- Solo admin. Marca closed_manually = true sin borrar el historial (opened_at
-- queda intacto para que get_state siga contando el recaudo correctamente).
-- -----------------------------------------------------------------------------
create or replace function public.close_capitalization_window()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden'
      using hint = 'Solo el administrador puede cerrar la ventana de capitalizaciones.';
  end if;

  update public.system_settings
     set value = jsonb_set(
       coalesce(value, '{}'::jsonb),
       '{closed_manually}',
       'true'::jsonb,
       true
     ),
     updated_at = now()
   where key = 'capitalization_window';

  return public.get_capitalization_window_state();
end;
$$;

revoke all on function public.close_capitalization_window() from public;
grant execute on function public.close_capitalization_window()
  to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Trigger: validar líneas de capitalización al insertar
--
-- No aplica a UPDATE porque una vez creado el receipt_item, el admin puede
-- aprobarlo aunque la ventana ya esté cerrada (por ejemplo, si el accionista
-- envió justo antes de que cerrara).
-- -----------------------------------------------------------------------------
create or replace function public.validate_receipt_item_capitalization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state       jsonb;
  v_today       date := (now() at time zone 'America/Bogota')::date;
  v_current_m   date := date_trunc('month', v_today)::date;
  v_is_open     boolean;
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

  -- Solo al insertar verificamos ventana abierta.
  v_state := public.get_capitalization_window_state();
  v_is_open := coalesce((v_state->>'is_open')::boolean, false);
  if not v_is_open then
    raise exception 'capitalization_window_closed'
      using hint = 'La ventana de capitalizaciones está cerrada.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_receipt_items_validate_capitalization
  on public.receipt_items;
create trigger trg_receipt_items_validate_capitalization
  before insert on public.receipt_items
  for each row execute function public.validate_receipt_item_capitalization();
