-- S5 T1: atomic loan disbursement (RN-4.17) with its CE in cash_outflows
-- (docs/modelo-datos.md, section 4.4) and its audit record (RN-9).
--
-- Before this, the route wrote the loan, the plan, the deduction receipt and its
-- items in separate calls. A failure halfway left an active loan without its
-- receipt, and nothing was audited. Now the domain still computes every amount in
-- TypeScript, and this function only stores them, in one transaction.

create type public.outflow_kind as enum ('loan_disbursement', 'expense', 'devolution');

create table public.cash_outflows (
  id uuid primary key default gen_random_uuid(),
  -- CE-#####, the same number the loan gets from disbursement_number_seq.
  ce_number text not null unique,
  kind public.outflow_kind not null,
  period_id uuid references public.periods (id),
  profile_id uuid references public.profiles (id),
  loan_id uuid references public.loans (id),
  -- Net amount that leaves the cash box. Zero when the deductions cover the loan.
  amount bigint not null check (amount >= 0),
  tax_4x1000 bigint not null default 0 check (tax_4x1000 >= 0),
  payment_method text not null check (payment_method in ('transfer', 'cash')),
  proof_path text,
  applied_month date check (applied_month = date_trunc('month', applied_month)::date),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id),
  void_reason text,
  constraint cash_outflows_loan_shape check (kind <> 'loan_disbursement' or loan_id is not null),
  constraint cash_outflows_devolution_shape check (kind <> 'devolution' or profile_id is not null)
);

comment on table public.cash_outflows is 'Libro de caja: salidas (CE). Written only by server RPCs.';

create index cash_outflows_period_month_idx on public.cash_outflows (period_id, applied_month);
create index cash_outflows_loan_idx on public.cash_outflows (loan_id);

alter table public.cash_outflows enable row level security;

create policy cash_outflows_select_own_or_admin_role on public.cash_outflows
  for select to authenticated
  using (profile_id = (select auth.uid()) or public.has_admin_role());

revoke all on table public.cash_outflows from public, anon, authenticated;
grant select on table public.cash_outflows to authenticated;
grant select, insert on table public.cash_outflows to service_role;

-- p_disbursement: disbursed_amount, four_per_thousand, disbursed_at,
--   full_rate_day_limit, cutoff_day, disbursement_proof_path, payment_method,
--   applied_month, interest_paid_month.
-- p_plan: rows of loan_payment_plan_items without id or loan_id.
-- p_receipt_items: rows of receipt_items without id or receipt_id. When there are
--   any, they go in one receipt that is approved here, so the approval trigger
--   lowers the balances it pays.
-- Returns the CE number.
create function public.desembolsar_prestamo(
  p_loan_id uuid,
  p_actor uuid,
  p_disbursement jsonb,
  p_plan jsonb,
  p_receipt_items jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan public.loans;
  v_amount bigint := (p_disbursement ->> 'disbursed_amount')::bigint;
  v_method text := p_disbursement ->> 'payment_method';
  v_at timestamptz := (p_disbursement ->> 'disbursed_at')::timestamptz;
  v_receipt_id uuid;
  v_ce text;
begin
  -- One disbursement at a time, so two of them cannot both pass the cash check.
  perform pg_advisory_xact_lock(hashtext('public.desembolsar_prestamo'));

  select * into v_loan from public.loans where id = p_loan_id for update;
  if not found then
    raise exception 'audit_entity_not_found';
  end if;
  if v_loan.status is distinct from 'pending_disbursement' then
    raise exception 'audit_status_conflict';
  end if;

  -- RN-4.14: shares paid upfront must be paid and approved before the money leaves.
  if v_loan.loan_shares_paid_upfront and not exists (
    select 1
      from public.receipt_items ri
      join public.receipts r on r.id = ri.receipt_id
     where ri.loan_id = p_loan_id
       and ri.concept = 'acciones_prestamo'
       and r.status = 'approved'
  ) then
    raise exception 'upfront_shares_unpaid';
  end if;

  -- RN-4.9: no disbursement without enough cash.
  if v_amount > public.get_cash_balance() then
    raise exception 'insufficient_cash_balance';
  end if;

  perform public.apply_audited_update(
    'loans',
    p_loan_id,
    jsonb_build_object(
      'status', 'active',
      'disbursed_amount', v_amount,
      'four_per_thousand', (p_disbursement ->> 'four_per_thousand')::bigint,
      'disbursed_at', v_at,
      'full_rate_day_limit', (p_disbursement ->> 'full_rate_day_limit')::int,
      'cutoff_day', (p_disbursement ->> 'cutoff_day')::int,
      'outstanding_balance', v_loan.requested_amount,
      'disbursement_proof_path', p_disbursement ->> 'disbursement_proof_path',
      'updated_at', v_at
    ),
    p_actor,
    'loan.disburse',
    'pending_disbursement'
  );

  select disbursement_number into v_ce from public.loans where id = p_loan_id;

  delete from public.loan_payment_plan_items where loan_id = p_loan_id;
  insert into public.loan_payment_plan_items
    (loan_id, month_number, due_date, capital_amount, estimated_interest, estimated_balance_after)
  select p_loan_id, i.month_number, i.due_date, i.capital_amount, i.estimated_interest, i.estimated_balance_after
    from jsonb_populate_recordset(null::public.loan_payment_plan_items, p_plan) i;

  if jsonb_array_length(p_receipt_items) > 0 then
    insert into public.receipts (user_id, status, submitted_at, total_amount, payment_method)
    values (v_loan.user_id, 'pending', v_at, 0, v_method)
    returning id into v_receipt_id;

    insert into public.receipt_items (receipt_id, concept, target_month, share_count, unit_value, amount, auto_generated, loan_id)
    select v_receipt_id, i.concept, i.target_month, i.share_count, i.unit_value, i.amount, i.auto_generated, i.loan_id
      from jsonb_populate_recordset(null::public.receipt_items, p_receipt_items) i;

    perform public.apply_audited_update(
      'receipts',
      v_receipt_id,
      jsonb_build_object('status', 'approved', 'reviewed_at', v_at, 'reviewed_by', p_actor),
      p_actor,
      'receipt.approve',
      'pending',
      'Deducciones del desembolso ' || v_ce
    );

    update public.loans
       set last_interest_payment_date = (p_disbursement ->> 'interest_paid_month')::date,
           updated_at = v_at
     where id in (
       select ri.loan_id from public.receipt_items ri
        where ri.receipt_id = v_receipt_id and ri.concept = 'pago_intereses' and ri.loan_id is not null
     );
  end if;

  insert into public.cash_outflows
    (ce_number, kind, period_id, profile_id, loan_id, amount, tax_4x1000, payment_method, proof_path, applied_month, created_by, created_at)
  values (
    v_ce,
    'loan_disbursement',
    (select id from public.periods where status = 'open'),
    v_loan.user_id,
    p_loan_id,
    v_amount,
    (p_disbursement ->> 'four_per_thousand')::bigint,
    v_method,
    p_disbursement ->> 'disbursement_proof_path',
    (p_disbursement ->> 'applied_month')::date,
    p_actor,
    v_at
  );

  return v_ce;
end;
$$;

revoke all on function public.desembolsar_prestamo(uuid, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.desembolsar_prestamo(uuid, uuid, jsonb, jsonb, jsonb) to service_role;
