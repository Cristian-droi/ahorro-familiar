-- =============================================================================
-- Dinero en pesos enteros: columnas de montos de numeric a bigint.
--
-- Contexto:
--   - Decisión D1 de docs/modelo-datos.md: el dominio trabaja con pesos
--     enteros (COP, sin centavos), pero hoy conviven numeric(14,2),
--     numeric(15,2) y numeric sin precisión.
--   - Las tasas y porcentajes (loans.interest_rate) siguen en numeric(6,4)
--     (decisión D2). Los montos guardados en system_settings son jsonb y no
--     cambian acá.
--
-- Qué hace (todo en una transacción):
--   1. Aborta si alguna fila tiene centavos. Nunca se redondea en silencio:
--      si falla, hay que corregir esos datos a mano antes de migrar.
--   2. Borra las dos funciones RETURN QUERY que declaran montos numeric
--      (fallarían al llamarlas con columnas bigint) y el CHECK
--      receipt_items_acciones_shape, que compara en numeric.
--   3. Pasa las 20 columnas de dinero a bigint.
--   4. Recrea el CHECK y las funciones devolviendo bigint, con sus GRANTs
--      explícitos. Por los default privileges de 20260809010000, anon ya no
--      recibe EXECUTE sobre ellas.
-- =============================================================================

-- 1. Precondición: ningún monto con centavos.
do $$
declare
  v_col record;
  v_filas bigint;
begin
  for v_col in
    select * from (values
      ('membership_requests', 'monthly_income'),
      ('profiles', 'monthly_income'),
      ('profiles', 'selected_share_value'),
      ('profiles', 'next_year_capitalization'),
      ('receipts', 'total_amount'),
      ('receipt_items', 'unit_value'),
      ('receipt_items', 'amount'),
      ('loans', 'requested_amount'),
      ('loans', 'loan_shares_amount'),
      ('loans', 'four_per_thousand'),
      ('loans', 'disbursed_amount'),
      ('loans', 'outstanding_balance'),
      ('loans', 'deducted_shares_amount'),
      ('loans', 'deducted_fines_amount'),
      ('loans', 'deducted_interest_amount'),
      ('loans', 'deducted_capital_amount'),
      ('loan_payment_plan_items', 'capital_amount'),
      ('loan_payment_plan_items', 'estimated_interest'),
      ('loan_payment_plan_items', 'estimated_balance_after'),
      ('capitalization_windows', 'max_amount')
    ) as t(tabla, columna)
  loop
    execute format(
      'select count(*) from public.%I where %I is not null and %I <> trunc(%I)',
      v_col.tabla, v_col.columna, v_col.columna, v_col.columna
    ) into v_filas;
    if v_filas > 0 then
      raise exception 'Hay % filas con centavos en %.%. Corrígelas antes de migrar a bigint.',
        v_filas, v_col.tabla, v_col.columna;
    end if;
  end loop;
end;
$$;

-- 2. Dependencias que no aceptan el cambio de tipo.
drop function public.get_capitalization_windows_admin();
drop function public.get_my_pending_loan_share_purchases();
alter table public.receipt_items drop constraint receipt_items_acciones_shape;

-- 3. Cambio de tipo, una sentencia por tabla para reescribir cada una una vez.
alter table public.membership_requests
  alter column monthly_income type bigint using monthly_income::bigint;

alter table public.profiles
  alter column monthly_income type bigint using monthly_income::bigint,
  alter column selected_share_value type bigint using selected_share_value::bigint,
  alter column next_year_capitalization type bigint using next_year_capitalization::bigint;

alter table public.receipts
  alter column total_amount type bigint using total_amount::bigint;

alter table public.receipt_items
  alter column unit_value type bigint using unit_value::bigint,
  alter column amount type bigint using amount::bigint;

alter table public.loans
  alter column requested_amount type bigint using requested_amount::bigint,
  alter column loan_shares_amount type bigint using loan_shares_amount::bigint,
  alter column four_per_thousand type bigint using four_per_thousand::bigint,
  alter column disbursed_amount type bigint using disbursed_amount::bigint,
  alter column outstanding_balance type bigint using outstanding_balance::bigint,
  alter column deducted_shares_amount type bigint using deducted_shares_amount::bigint,
  alter column deducted_fines_amount type bigint using deducted_fines_amount::bigint,
  alter column deducted_interest_amount type bigint using deducted_interest_amount::bigint,
  alter column deducted_capital_amount type bigint using deducted_capital_amount::bigint;

alter table public.loan_payment_plan_items
  alter column capital_amount type bigint using capital_amount::bigint,
  alter column estimated_interest type bigint using estimated_interest::bigint,
  alter column estimated_balance_after type bigint using estimated_balance_after::bigint;

alter table public.capitalization_windows
  alter column max_amount type bigint using max_amount::bigint;

-- 4. Recrear el CHECK, ahora en enteros.
alter table public.receipt_items
  add constraint receipt_items_acciones_shape check (
    concept <> 'acciones'::public.receipt_concept
    or (share_count is not null and unit_value is not null and amount = share_count * unit_value)
  );

-- 5. Recrear las funciones con montos bigint. La lógica no cambia.
create function public.get_capitalization_windows_admin()
returns table (
  id uuid,
  scope text,
  user_id uuid,
  user_name text,
  user_document text,
  max_amount bigint,
  used_amount bigint,
  remaining bigint,
  deadline date,
  opened_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
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
           coalesce(sum(ri.amount), 0)::bigint as used
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
    coalesce(u.used, 0)::bigint as used_amount,
    case when a.scope = 'user' then greatest(a.max_amount - coalesce(u.used, 0), 0)::bigint end as remaining,
    a.deadline,
    a.opened_at
  from active a
  left join public.profiles p on p.id = a.user_id
  left join used_by_user u on u.window_id = a.id
  order by a.scope desc, a.opened_at desc;
end;
$function$;

revoke all on function public.get_capitalization_windows_admin() from public;
grant execute on function public.get_capitalization_windows_admin() to authenticated;

create function public.get_my_pending_loan_share_purchases()
returns table (
  loan_id uuid,
  loan_created_at timestamptz,
  requested_amount bigint,
  loan_shares_count integer,
  loan_shares_amount bigint,
  unit_value bigint
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return;
  end if;

  return query
  select
    l.id,
    l.created_at,
    l.requested_amount,
    l.loan_shares_count,
    l.loan_shares_amount,
    -- loan_shares_amount = loan_shares_count × valor de acción (RN-4.14),
    -- así que la división entera es exacta.
    case
      when l.loan_shares_count is not null and l.loan_shares_count > 0
        then l.loan_shares_amount / l.loan_shares_count
      else null
    end as unit_value
  from public.loans l
  where l.user_id = v_uid
    and l.status  = 'pending_disbursement'
    and coalesce(l.loan_shares_paid_upfront, false) = true
    and coalesce(l.loan_shares_amount, 0) > 0
    and not exists (
      select 1
        from public.receipt_items ri
        join public.receipts r on r.id = ri.receipt_id
       where ri.loan_id = l.id
         and ri.concept = 'acciones_prestamo'
         and r.status in ('pending', 'approved')
    )
  order by l.created_at;
end;
$function$;

revoke all on function public.get_my_pending_loan_share_purchases() from public;
grant execute on function public.get_my_pending_loan_share_purchases()
  to authenticated, service_role;
