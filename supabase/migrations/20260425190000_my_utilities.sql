-- =============================================================================
-- Utilidades del accionista — distribución mensual de intereses
--
-- Modelo (acordado con el user):
--   participación(M) =
--     (aportes_mios_acumulados con target_month ≤ fin_de_M)
--     / (aportes_totales_acumulados con target_month ≤ fin_de_M)
--
--   utilidades_pool(M) =
--     SUM(receipt_items.amount) WHERE concept='pago_intereses'
--     AND receipts.status='approved' AND target_month = inicio_de_M
--
--   distribución(M) = participación(M) * utilidades_pool(M)
--
-- "aportes" = acciones + acciones_prestamo + capitalizacion (sumados en
-- valor monetario, NO cantidad). Solo cuentan recibos aprobados.
--
-- Ganancia anual = SUM(distribución(M)) para M=1..12.
--
-- La función es SECURITY DEFINER porque expone agregados del fondo
-- entero (RLS bloquea ver receipts de otros accionistas), pero solo el
-- valor agregado, nunca filas individuales.
-- =============================================================================

create or replace function public.get_my_utilities_by_year(p_year integer)
returns table (
  month_number   integer,
  participation  numeric,
  utilities_pool numeric,
  distribution   numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  m              integer;
  v_month_start  date;
  v_month_end    date;
  v_my_acum      numeric;
  v_total_acum   numeric;
  v_pool         numeric;
  v_part         numeric;
begin
  if v_uid is null then
    return;
  end if;

  if p_year is null or p_year < 2000 or p_year > 2100 then
    raise exception 'invalid_year';
  end if;

  for m in 1..12 loop
    v_month_start := make_date(p_year, m, 1);
    v_month_end   := (v_month_start + interval '1 month - 1 day')::date;

    -- Aportes míos acumulados (target_month ≤ fin de mes M).
    select coalesce(sum(ri.amount), 0)
      into v_my_acum
      from public.receipt_items ri
      join public.receipts r on r.id = ri.receipt_id
     where r.status   = 'approved'
       and r.user_id  = v_uid
       and ri.concept in ('acciones', 'acciones_prestamo', 'capitalizacion')
       and ri.target_month <= v_month_end;

    -- Aportes totales (todos los accionistas) hasta fin de mes M.
    select coalesce(sum(ri.amount), 0)
      into v_total_acum
      from public.receipt_items ri
      join public.receipts r on r.id = ri.receipt_id
     where r.status   = 'approved'
       and ri.concept in ('acciones', 'acciones_prestamo', 'capitalizacion')
       and ri.target_month <= v_month_end;

    -- Pool de utilidades del mes M = pagos de intereses con
    -- target_month = primer día de M.
    select coalesce(sum(ri.amount), 0)
      into v_pool
      from public.receipt_items ri
      join public.receipts r on r.id = ri.receipt_id
     where r.status   = 'approved'
       and ri.concept = 'pago_intereses'
       and ri.target_month = v_month_start;

    if v_total_acum > 0 then
      v_part := v_my_acum / v_total_acum;
    else
      v_part := 0;
    end if;

    month_number   := m;
    participation  := v_part;
    utilities_pool := v_pool;
    distribution   := round(v_part * v_pool);
    return next;
  end loop;
end;
$$;

revoke all on function public.get_my_utilities_by_year(integer) from public;
grant execute on function public.get_my_utilities_by_year(integer)
  to authenticated, service_role;
