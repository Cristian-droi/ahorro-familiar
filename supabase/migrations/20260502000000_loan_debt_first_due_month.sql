-- =============================================================================
-- Alinea get_user_active_loans_debt con la lógica del detalle del préstamo
-- y del approve route: el mes del desembolso es la PRIMERA cuota del plan,
-- y cuando ese mes ya pasó (por estar en el mes calendario siguiente)
-- se considera mes vencido y entra al cálculo de intereses adeudados.
--
-- Antes: v_first_due = v_disb_month + 1 month → ignoraba el mes del
-- desembolso. Hoy 1 de mayo, préstamo de abril → no veía deuda. Pero el
-- detalle del préstamo y el trigger de approve sí veían deuda.
--
-- Ahora: v_first_due = v_disb_month. Mientras v_iter < v_curr_month entra
-- al loop y suma interés del mes (con regla de medio interés si día > 15
-- en el primer mes — consistente con buildPaymentPlan).
-- =============================================================================

create or replace function public.get_user_active_loans_debt()
returns table (
  loan_id              uuid,
  disbursement_number  text,
  requested_amount     numeric,
  outstanding_capital  numeric,
  interest_rate        numeric,
  disbursed_at         timestamptz,
  interest_owed        numeric,
  months_overdue       integer,
  next_due_month       date
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid           uuid := auth.uid();
  v_today         date := (now() at time zone 'America/Bogota')::date;
  v_curr_month    date := date_trunc('month', v_today)::date;
  r               record;
  v_saldo         numeric;
  v_iter          date;
  v_first_due     date;
  v_disb_month    date;
  v_disb_day      integer;
  v_total_owed    numeric;
  v_paid_int      numeric;
  v_overdue_n     integer;
  v_eff_rate      numeric;
  v_paid_in_month numeric;
  v_next_due      date;
begin
  if v_uid is null then
    return;
  end if;

  for r in
    select l.id, l.disbursement_number, l.requested_amount, l.interest_rate,
           l.disbursed_at, l.outstanding_balance
      from public.loans l
     where l.user_id = v_uid
       and l.status  = 'active'
       and l.disbursed_at is not null
  loop
    v_saldo      := r.requested_amount;
    v_total_owed := 0;
    v_overdue_n  := 0;
    v_disb_day   := extract(day from r.disbursed_at at time zone 'America/Bogota')::integer;
    v_disb_month := date_trunc('month', (r.disbursed_at at time zone 'America/Bogota')::date)::date;
    -- IMPORTANTE: el mes del desembolso ES el primer mes del plan
    -- (cuota 1 según buildPaymentPlan). Cuando ese mes ya pasó (estamos
    -- en el mes calendario siguiente), entra como mes vencido.
    v_first_due  := v_disb_month;
    v_iter       := v_first_due;

    while v_iter < v_curr_month loop
      v_eff_rate := r.interest_rate;
      if v_iter = v_first_due and v_disb_day > 15 then
        v_eff_rate := r.interest_rate / 2;
      end if;

      v_total_owed := v_total_owed + round(v_saldo * v_eff_rate);

      select coalesce(sum(ri.amount), 0)
        into v_paid_in_month
        from public.receipt_items ri
        join public.receipts rc on rc.id = ri.receipt_id
       where ri.loan_id    = r.id
         and ri.concept    = 'pago_capital'
         and rc.status     = 'approved'
         and ri.target_month = v_iter;

      v_saldo     := greatest(v_saldo - v_paid_in_month, 0);
      v_overdue_n := v_overdue_n + 1;
      v_iter      := (v_iter + interval '1 month')::date;
    end loop;

    select coalesce(sum(ri.amount), 0)
      into v_paid_int
      from public.receipt_items ri
      join public.receipts rc on rc.id = ri.receipt_id
     where ri.loan_id = r.id
       and ri.concept = 'pago_intereses'
       and rc.status  = 'approved';

    select coalesce(sum(ri.amount), 0)
      into v_paid_in_month
      from public.receipt_items ri
      join public.receipts rc on rc.id = ri.receipt_id
     where ri.loan_id    = r.id
       and ri.concept    = 'pago_capital'
       and rc.status     = 'approved'
       and ri.target_month >= v_curr_month;
    v_saldo := greatest(v_saldo - v_paid_in_month, 0);

    -- Clamp para no devolver mes anterior al primer mes del plan.
    v_next_due := greatest((v_curr_month - interval '1 month')::date, v_disb_month);

    loan_id              := r.id;
    disbursement_number  := r.disbursement_number;
    requested_amount     := r.requested_amount;
    outstanding_capital  := v_saldo;
    interest_rate        := r.interest_rate;
    disbursed_at         := r.disbursed_at;
    interest_owed        := greatest(v_total_owed - v_paid_int, 0);
    months_overdue       := v_overdue_n;
    next_due_month       := v_next_due;
    return next;
  end loop;
end;
$$;
