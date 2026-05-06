-- =============================================================================
-- Fix: el cálculo de "fin de mes" en get_my_utilities_by_year y
-- get_user_active_loans_debt usaba interval '1 month - 1 day', que en
-- algunos parseos de postgres queda solo como '1 month' → v_month_end
-- terminaba siendo el primer día del mes siguiente, y el filtro
-- target_month <= v_month_end incluía aportes del mes siguiente.
--
-- Síntoma: un accionista que solo aportó en abril veía un % de
-- participación en marzo (porque sumaba sus aportes de target_month=abril
-- como si fueran "hasta fin de marzo").
--
-- Solución: comparar con `<` contra el primer día del mes siguiente
-- (sintaxis que no depende de cómo postgres parsea intervals compuestos).
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
  v_next_month   date;
  v_my_acum      numeric;
  v_total_acum   numeric;
  v_pool         numeric;
  v_part         numeric;
begin
  if v_uid is null then return; end if;
  if p_year is null or p_year < 2000 or p_year > 2100 then
    raise exception 'invalid_year';
  end if;

  for m in 1..12 loop
    v_month_start := make_date(p_year, m, 1);
    v_next_month  := (v_month_start + interval '1 month')::date;

    -- Aportes míos con target_month estrictamente anterior al primer
    -- día del mes siguiente (es decir: hasta el último día de este mes,
    -- inclusive).
    select coalesce(sum(ri.amount), 0)
      into v_my_acum
      from public.receipt_items ri
      join public.receipts r on r.id = ri.receipt_id
     where r.status   = 'approved'
       and r.user_id  = v_uid
       and ri.concept in ('acciones', 'acciones_prestamo', 'capitalizacion')
       and ri.target_month < v_next_month;

    select coalesce(sum(ri.amount), 0)
      into v_total_acum
      from public.receipt_items ri
      join public.receipts r on r.id = ri.receipt_id
     where r.status   = 'approved'
       and ri.concept in ('acciones', 'acciones_prestamo', 'capitalizacion')
       and ri.target_month < v_next_month;

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

create or replace function public.get_user_utilities_by_year(
  p_user_id uuid,
  p_year    integer
)
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
  m              integer;
  v_month_start  date;
  v_next_month   date;
  v_my_acum      numeric;
  v_total_acum   numeric;
  v_pool         numeric;
  v_part         numeric;
begin
  if not public.is_admin() then
    raise exception 'forbidden'
      using hint = 'Solo el administrador puede consultar utilidades de otros accionistas.';
  end if;
  if p_user_id is null then raise exception 'invalid_user'; end if;
  if p_year is null or p_year < 2000 or p_year > 2100 then
    raise exception 'invalid_year';
  end if;

  for m in 1..12 loop
    v_month_start := make_date(p_year, m, 1);
    v_next_month  := (v_month_start + interval '1 month')::date;

    select coalesce(sum(ri.amount), 0)
      into v_my_acum
      from public.receipt_items ri
      join public.receipts r on r.id = ri.receipt_id
     where r.status   = 'approved'
       and r.user_id  = p_user_id
       and ri.concept in ('acciones', 'acciones_prestamo', 'capitalizacion')
       and ri.target_month < v_next_month;

    select coalesce(sum(ri.amount), 0)
      into v_total_acum
      from public.receipt_items ri
      join public.receipts r on r.id = ri.receipt_id
     where r.status   = 'approved'
       and ri.concept in ('acciones', 'acciones_prestamo', 'capitalizacion')
       and ri.target_month < v_next_month;

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
