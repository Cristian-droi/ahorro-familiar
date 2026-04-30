-- Fix de get_user_active_loans_debt: el next_due_month nunca debe ser
-- anterior al primer mes del plan del préstamo (mes calendario del
-- desembolso). Si lo es, los pagos quedan "fuera del plan" y la UI no
-- los matchea con ninguna cuota → el saldo no se actualiza.
--
-- Solución: clampar next_due_month a max(mes_anterior_al_actual,
-- primer_mes_del_plan).

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
    v_first_due  := (v_disb_month + interval '1 month')::date;
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

    -- Clamp: el target_month que devolvemos debe caer DENTRO del plan
    -- (es decir, >= mes del desembolso). Si v_curr_month - 1 mes cae
    -- antes (caso préstamo recién desembolsado este mismo mes), usamos
    -- el primer mes del plan. Esto evita que los pagos queden fuera del
    -- rango del plan y no se reflejen en la UI.
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
