-- =============================================================================
-- get_loan_interest_owed(p_loan_id) — calcula el interés adeudado al día
-- de un préstamo específico, usando la MISMA lógica que
-- get_user_active_loans_debt:
--   - recorre mes a mes desde el mes del desembolso (a mes vencido),
--   - calcula interés sobre el saldo al INICIO de cada mes (la regla
--     correcta acordada con el user),
--   - resta pagos a capital con target_month = mes,
--   - resta pagos de intereses ya approved.
--
-- Lo usa el endpoint /api/receipts/[id]/approve para validar de forma
-- consistente (no más basado en last_interest_payment_date que era
-- aproximado).
-- =============================================================================

create or replace function public.get_loan_interest_owed(p_loan_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today        date := (now() at time zone 'America/Bogota')::date;
  v_curr_month   date := date_trunc('month', v_today)::date;
  v_loan         record;
  v_saldo        numeric;
  v_iter         date;
  v_disb_month   date;
  v_disb_day     integer;
  v_total_owed   numeric := 0;
  v_paid_int     numeric;
  v_eff_rate     numeric;
  v_paid_in_month numeric;
begin
  select id, requested_amount, interest_rate, disbursed_at
    into v_loan
    from public.loans
   where id = p_loan_id and disbursed_at is not null;

  if v_loan.id is null then
    return 0;
  end if;

  v_saldo      := v_loan.requested_amount;
  v_disb_day   := extract(day from v_loan.disbursed_at at time zone 'America/Bogota')::integer;
  v_disb_month := date_trunc('month', (v_loan.disbursed_at at time zone 'America/Bogota')::date)::date;
  v_iter       := v_disb_month;

  while v_iter < v_curr_month loop
    v_eff_rate := v_loan.interest_rate;
    if v_iter = v_disb_month and v_disb_day > 15 then
      v_eff_rate := v_loan.interest_rate / 2;
    end if;

    v_total_owed := v_total_owed + round(v_saldo * v_eff_rate);

    select coalesce(sum(ri.amount), 0)
      into v_paid_in_month
      from public.receipt_items ri
      join public.receipts r on r.id = ri.receipt_id
     where ri.loan_id = v_loan.id
       and ri.concept = 'pago_capital'
       and r.status = 'approved'
       and ri.target_month = v_iter;

    v_saldo := greatest(v_saldo - v_paid_in_month, 0);
    v_iter  := (v_iter + interval '1 month')::date;
  end loop;

  select coalesce(sum(ri.amount), 0)
    into v_paid_int
    from public.receipt_items ri
    join public.receipts r on r.id = ri.receipt_id
   where ri.loan_id = v_loan.id
     and ri.concept = 'pago_intereses'
     and r.status = 'approved';

  return greatest(v_total_owed - v_paid_int, 0);
end;
$$;

revoke all on function public.get_loan_interest_owed(uuid) from public;
grant execute on function public.get_loan_interest_owed(uuid)
  to authenticated, service_role;
