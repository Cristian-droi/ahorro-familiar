-- =============================================================================
-- Pagos de préstamos (capital + intereses) — backend
--
-- Reglas (acordadas con el user):
--   - El préstamo paga a mes vencido: el primer interés se cobra el mes
--     SIGUIENTE al desembolso (mes 0 = mes de desembolso, sin interés).
--   - El interés del mes se calcula sobre el saldo de capital al INICIO
--     del mes (baja conforme se paga capital). Tasa = loan.interest_rate.
--   - Regla de "medio interés": si el primer mes vencido coincide con
--     disbursed_day > 15, se cobra rate/2 (consistente con buildPaymentPlan).
--   - El accionista debe pagar TODOS los intereses vencidos
--     obligatoriamente antes de poder abonar capital.
--   - El abono a capital es libre; reduce el saldo y los intereses futuros
--     se recalculan sobre el nuevo saldo.
--   - Cuando outstanding_balance llega a 0, el préstamo pasa a 'paid'.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. RPC: get_user_active_loans_debt
--
-- Para cada préstamo activo del usuario actual (auth.uid), calcula:
--   - outstanding_capital: saldo actual.
--   - interest_owed:       intereses adeudados hasta el mes anterior, neto
--                          de pagos ya realizados.
--   - months_overdue:      meses vencidos contados.
--   - next_due_month:      primer día del mes anterior al actual (target_month
--                          que deben usar los receipt_items del pago).
-- -----------------------------------------------------------------------------
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
  v_disb_day      integer;
  v_total_owed    numeric;
  v_paid_int      numeric;
  v_overdue_n     integer;
  v_eff_rate      numeric;
  v_paid_in_month numeric;
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
    v_first_due  := (date_trunc('month', (r.disbursed_at at time zone 'America/Bogota')::date) + interval '1 month')::date;
    v_iter       := v_first_due;

    -- Recorremos cada mes vencido (mes_iter < mes_actual). Para cada mes:
    -- 1) calculamos el interés sobre el saldo al inicio del mes,
    -- 2) restamos los pagos a capital con target_month = ese mes (efecto al
    --    final del mes — los pagos del mes ya bajan el saldo para el mes
    --    siguiente).
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

    -- Lo ya pagado en intereses para este loan (cualquier mes).
    select coalesce(sum(ri.amount), 0)
      into v_paid_int
      from public.receipt_items ri
      join public.receipts rc on rc.id = ri.receipt_id
     where ri.loan_id = r.id
       and ri.concept = 'pago_intereses'
       and rc.status  = 'approved';

    -- Restamos también los pagos de capital del mes ACTUAL (que aún no
    -- entraron en el loop), para reflejar el saldo real "ahora".
    select coalesce(sum(ri.amount), 0)
      into v_paid_in_month
      from public.receipt_items ri
      join public.receipts rc on rc.id = ri.receipt_id
     where ri.loan_id    = r.id
       and ri.concept    = 'pago_capital'
       and rc.status     = 'approved'
       and ri.target_month >= v_curr_month;
    v_saldo := greatest(v_saldo - v_paid_in_month, 0);

    loan_id              := r.id;
    disbursement_number  := r.disbursement_number;
    requested_amount     := r.requested_amount;
    outstanding_capital  := v_saldo;
    interest_rate        := r.interest_rate;
    disbursed_at         := r.disbursed_at;
    interest_owed        := greatest(v_total_owed - v_paid_int, 0);
    months_overdue       := v_overdue_n;
    next_due_month       := (v_curr_month - interval '1 month')::date;
    return next;
  end loop;
end;
$$;

revoke all on function public.get_user_active_loans_debt() from public;
grant execute on function public.get_user_active_loans_debt()
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Trigger: apply_loan_payment_on_receipt_approval
--
-- Cuando un receipt pasa de pending → approved, recorre sus items con
-- concept='pago_capital' y resta sus montos del outstanding_balance del loan.
-- Si el saldo llega a 0, marca el préstamo como 'paid'.
--
-- Si el recibo se rechaza/elimina después de approved no revertimos
-- automáticamente — la regla actual del proyecto es que los recibos
-- aprobados son inmutables (no se rechazan). Si llega a pasar, el admin
-- corrige a mano.
-- -----------------------------------------------------------------------------
create or replace function public.apply_loan_payment_on_receipt_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if new.status <> 'approved' then
    return new;
  end if;
  if old.status = 'approved' then
    return new;  -- ya estaba aprobado; no doble-aplicar
  end if;

  for r in
    select ri.loan_id, sum(ri.amount) as total
      from public.receipt_items ri
     where ri.receipt_id = new.id
       and ri.concept    = 'pago_capital'
       and ri.loan_id is not null
     group by ri.loan_id
  loop
    update public.loans
       set outstanding_balance = greatest(outstanding_balance - r.total, 0),
           status = case
             when greatest(outstanding_balance - r.total, 0) = 0 then 'paid'::loan_status
             else status
           end,
           updated_at = now()
     where id = r.loan_id;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_apply_loan_payment on public.receipts;
create trigger trg_apply_loan_payment
  after update of status on public.receipts
  for each row
  when (new.status = 'approved' and old.status <> 'approved')
  execute function public.apply_loan_payment_on_receipt_approval();

-- -----------------------------------------------------------------------------
-- 3. Validación: receipt_items pago_capital / pago_intereses requieren
--    loan_id y deben corresponder a un préstamo activo del mismo usuario.
-- -----------------------------------------------------------------------------
create or replace function public.validate_receipt_item_loan_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan_user uuid;
  v_loan_status loan_status;
  v_receipt_user uuid;
begin
  if new.concept not in ('pago_capital', 'pago_intereses') then
    return new;
  end if;

  if new.loan_id is null then
    raise exception 'loan_payment_requires_loan_id'
      using hint = 'Debes asociar el pago a un préstamo (loan_id).';
  end if;

  if new.amount is null or new.amount <= 0 then
    raise exception 'loan_payment_invalid_amount'
      using hint = 'El monto del pago debe ser mayor a cero.';
  end if;

  select user_id, status into v_loan_user, v_loan_status
    from public.loans where id = new.loan_id;
  if v_loan_user is null then
    raise exception 'loan_not_found';
  end if;

  if v_loan_status not in ('active', 'paid') then
    raise exception 'loan_not_active'
      using hint = 'El préstamo no está activo.';
  end if;

  select user_id into v_receipt_user
    from public.receipts where id = new.receipt_id;
  if v_receipt_user is null then
    raise exception 'receipt_not_found';
  end if;

  if v_receipt_user <> v_loan_user then
    raise exception 'loan_payment_user_mismatch'
      using hint = 'El préstamo no pertenece al usuario del recibo.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_receipt_item_loan_payment on public.receipt_items;
create trigger trg_validate_receipt_item_loan_payment
  before insert on public.receipt_items
  for each row execute function public.validate_receipt_item_loan_payment();
