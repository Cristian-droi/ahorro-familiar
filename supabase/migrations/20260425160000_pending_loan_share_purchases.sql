-- =============================================================================
-- Acciones por préstamo (upfront) — pendientes de pago por el accionista
--
-- Cuando un accionista solicita un préstamo y eligió pagar las acciones por
-- préstamo POR ADELANTADO (loan_shares_paid_upfront = true), debe enviar un
-- recibo CI con concepto 'acciones_prestamo' antes de que el admin pueda
-- desembolsar. El backend de disburse ya bloquea sin ese recibo aprobado.
--
-- Este módulo expone dos RPCs (security definer) para que la UI del
-- accionista:
--   - liste los préstamos suyos que aún esperan ese pago,
--   - cuente cuántos hay (para el badge en sidebar / header).
--
-- "Pendiente" = loan en estado pending_disbursement, con upfront=true y
-- loan_shares_amount>0, y SIN recibo (pending o approved) que ya tenga un
-- item acciones_prestamo ligado a ese loan.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Listado: get_my_pending_loan_share_purchases
-- -----------------------------------------------------------------------------
create or replace function public.get_my_pending_loan_share_purchases()
returns table (
  loan_id              uuid,
  loan_created_at      timestamptz,
  requested_amount     numeric,
  loan_shares_count    integer,
  loan_shares_amount   numeric,
  unit_value           numeric
)
language plpgsql
security definer
set search_path = public
as $$
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
$$;

revoke all on function public.get_my_pending_loan_share_purchases() from public;
grant execute on function public.get_my_pending_loan_share_purchases()
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Conteo: count_my_pending_loan_share_purchases
-- -----------------------------------------------------------------------------
create or replace function public.count_my_pending_loan_share_purchases()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n   integer := 0;
begin
  if v_uid is null then return 0; end if;

  select count(*)::int into v_n
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
     );

  return v_n;
end;
$$;

revoke all on function public.count_my_pending_loan_share_purchases() from public;
grant execute on function public.count_my_pending_loan_share_purchases()
  to authenticated, service_role;
