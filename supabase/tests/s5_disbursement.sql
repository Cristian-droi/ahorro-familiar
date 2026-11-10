-- S5 T1 probes: atomic disbursement (RN-4.17), upfront shares (RN-4.14), cash
-- (RN-4.9), cash_outflows access and audit. Runs in one transaction and rolls
-- back. Any failed expectation raises.
--
-- docker exec -i supabase_db_app psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/s5_disbursement.sql

begin;

create function pg_temp.attempt(p_role text, p_uid uuid, p_sql text)
returns text
language plpgsql
as $$
declare
  n bigint;
  outcome text;
  violated text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_role)::text, true);
  perform set_config('role', p_role, true);
  begin
    execute p_sql;
    get diagnostics n = row_count;
    outcome := n::text;
  exception
    when insufficient_privilege then
      outcome := 'denied';
    when check_violation then
      get stacked diagnostics violated = constraint_name;
      outcome := 'check:' || violated;
    when raise_exception then
      outcome := 'raised:' || sqlerrm;
  end;
  perform set_config('role', 'postgres', true);
  return outcome;
end;
$$;

create function pg_temp.expect(p_label text, p_actual text, p_expected text)
returns void
language plpgsql
as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL %: expected %, got %', p_label, p_expected, p_actual;
  end if;
  raise notice 'ok  %', p_label;
end;
$$;

-- Disbursement values as the route sends them. Built as postgres and passed as a
-- literal, since the probed roles cannot call pg_temp functions.
create function pg_temp.values_for(p_amount bigint)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'disbursed_amount', p_amount,
    'four_per_thousand', 3600,
    'disbursed_at', '2026-11-20T15:00:00Z',
    'full_rate_day_limit', 15,
    'cutoff_day', 25,
    'disbursement_proof_path', 'proofs/probe.png',
    'payment_method', 'transfer',
    'applied_month', '2026-11-01',
    'interest_paid_month', '2026-11-01'
  );
$$;

-- Fixtures: a shareholder, another shareholder, a tesorero and a gerente.
insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000005a'),
  ('00000000-0000-0000-0000-00000000005b'),
  ('00000000-0000-0000-0000-00000000005c'),
  ('00000000-0000-0000-0000-00000000005d');

insert into public.profiles (id, first_name, identity_document, role) values
  ('00000000-0000-0000-0000-00000000005a', 'Ana', 'probe5-a', 'accionista'),
  ('00000000-0000-0000-0000-00000000005b', 'Beto', 'probe5-b', 'accionista'),
  ('00000000-0000-0000-0000-00000000005c', 'Tere', 'probe5-c', 'admin'),
  ('00000000-0000-0000-0000-00000000005d', 'Gere', 'probe5-d', 'accionista');

update public.profiles set admin_role = 'tesorero' where id = '00000000-0000-0000-0000-00000000005c';
update public.profiles set admin_role = 'gerente' where id = '00000000-0000-0000-0000-00000000005d';

-- Cash in the box: one approved purchase of 5.000.000.
insert into public.receipts (id, user_id, status, total_amount) values
  ('00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-00000000005b', 'pending', 0);
insert into public.receipt_items (receipt_id, concept, target_month, share_count, unit_value, amount) values
  ('00000000-0000-0000-0000-0000000005e1', 'acciones', '2026-11-01', 10, 500000, 5000000);
update public.receipts set status = 'approved', reviewed_at = now(), reviewed_by = '00000000-0000-0000-0000-00000000005c' where id = '00000000-0000-0000-0000-0000000005e1';

insert into public.loans (id, user_id, requested_amount, status, loan_shares_count, loan_shares_amount, loan_shares_paid_upfront) values
  -- ready, shares discounted
  ('00000000-0000-0000-0000-0000000005f1', '00000000-0000-0000-0000-00000000005a', 1000000, 'pending_disbursement', 2, 100000, false),
  -- shares chosen upfront and not paid
  ('00000000-0000-0000-0000-0000000005f2', '00000000-0000-0000-0000-00000000005a', 1000000, 'pending_disbursement', 2, 100000, true),
  -- already disbursed
  ('00000000-0000-0000-0000-0000000005f3', '00000000-0000-0000-0000-00000000005a', 1000000, 'active', 0, 0, false),
  -- more than the cash box
  ('00000000-0000-0000-0000-0000000005f4', '00000000-0000-0000-0000-00000000005a', 9000000, 'pending_disbursement', 0, 0, false),
  -- used for the rollback probe
  ('00000000-0000-0000-0000-0000000005f5', '00000000-0000-0000-0000-00000000005a', 1000000, 'pending_disbursement', 0, 0, false);

-- Only the server runs it.
select pg_temp.expect('authenticated cannot disburse',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000005c',
    format($q$select public.desembolsar_prestamo('00000000-0000-0000-0000-0000000005f1', '00000000-0000-0000-0000-00000000005c', %L::jsonb, '[]', '[]')$q$, pg_temp.values_for(896400))),
  'denied');

-- RN-4.14: unpaid upfront shares block the disbursement.
select pg_temp.expect('upfront shares not approved block the disbursement',
  pg_temp.attempt('service_role', null,
    format($q$select public.desembolsar_prestamo('00000000-0000-0000-0000-0000000005f2', '00000000-0000-0000-0000-00000000005c', %L::jsonb, '[]', '[]')$q$, pg_temp.values_for(996000))),
  'raised:upfront_shares_unpaid');
select pg_temp.expect('the blocked loan stays pending',
  (select status::text from public.loans where id = '00000000-0000-0000-0000-0000000005f2'), 'pending_disbursement');

-- A loan that is not pending disbursement is a stale request.
select pg_temp.expect('an active loan cannot be disbursed again',
  pg_temp.attempt('service_role', null,
    format($q$select public.desembolsar_prestamo('00000000-0000-0000-0000-0000000005f3', '00000000-0000-0000-0000-00000000005c', %L::jsonb, '[]', '[]')$q$, pg_temp.values_for(996000))),
  'raised:audit_status_conflict');

-- RN-4.9: no disbursement without enough cash.
select pg_temp.expect('a disbursement above the cash box is rejected',
  pg_temp.attempt('service_role', null,
    format($q$select public.desembolsar_prestamo('00000000-0000-0000-0000-0000000005f4', '00000000-0000-0000-0000-00000000005c', %L::jsonb, '[]', '[]')$q$, pg_temp.values_for(8964000))),
  'raised:insufficient_cash_balance');

-- RN-4.17: a failure halfway leaves nothing behind. The second plan row has no
-- due date, so the plan insert fails after the loan was already updated.
do $$
begin
  perform public.desembolsar_prestamo(
    '00000000-0000-0000-0000-0000000005f5', '00000000-0000-0000-0000-00000000005c', pg_temp.values_for(996000),
    '[{"month_number":1,"due_date":"2026-12-01","capital_amount":500000,"estimated_interest":20000,"estimated_balance_after":500000},
      {"month_number":2,"due_date":null,"capital_amount":500000,"estimated_interest":10000,"estimated_balance_after":0}]',
    '[]');
  raise exception 'FAIL the broken disbursement should have failed';
exception
  when not_null_violation then
    raise notice 'ok  a broken plan aborts the disbursement';
end;
$$;
select pg_temp.expect('after the failure the loan is still pending',
  (select status::text || '/' || coalesce(disbursement_number, 'none') from public.loans where id = '00000000-0000-0000-0000-0000000005f5'),
  'pending_disbursement/none');
select pg_temp.expect('after the failure there is no CE',
  (select count(*)::text from public.cash_outflows where loan_id = '00000000-0000-0000-0000-0000000005f5'), '0');
select pg_temp.expect('after the failure there is no audit record',
  (select count(*)::text from public.audit_log where entity_id = '00000000-0000-0000-0000-0000000005f5'), '0');

-- The happy path: shares discounted, one plan row.
select public.desembolsar_prestamo(
  '00000000-0000-0000-0000-0000000005f1', '00000000-0000-0000-0000-00000000005c', pg_temp.values_for(896400),
  '[{"month_number":1,"due_date":"2026-12-01","capital_amount":1000000,"estimated_interest":10000,"estimated_balance_after":0}]',
  '[{"concept":"acciones_prestamo","target_month":"2026-11-01","share_count":2,"unit_value":50000,"amount":100000,"loan_id":"00000000-0000-0000-0000-0000000005f1","auto_generated":false}]'
) as ce \gset

select pg_temp.expect('the loan is active with its full balance and the CE',
  (select status::text || '/' || outstanding_balance::text || '/' || disbursed_amount::text || '/' || (disbursement_number = :'ce')::text
     from public.loans where id = '00000000-0000-0000-0000-0000000005f1'),
  'active/1000000/896400/true');
select pg_temp.expect('the CE is in cash_outflows with the net, the tax and the applied month',
  (select count(*)::text from public.cash_outflows
    where ce_number = :'ce' and kind = 'loan_disbursement' and amount = 896400 and tax_4x1000 = 3600
      and applied_month = '2026-11-01' and profile_id = '00000000-0000-0000-0000-00000000005a'
      and created_by = '00000000-0000-0000-0000-00000000005c'),
  '1');
select pg_temp.expect('the plan was replaced',
  (select count(*)::text from public.loan_payment_plan_items where loan_id = '00000000-0000-0000-0000-0000000005f1'), '1');
select pg_temp.expect('the deduction receipt is approved with the shares',
  (select r.status::text || '/' || r.total_amount::text
     from public.receipts r join public.receipt_items ri on ri.receipt_id = r.id
    where ri.loan_id = '00000000-0000-0000-0000-0000000005f1' and ri.concept = 'acciones_prestamo'),
  'approved/100000');
select pg_temp.expect('the disbursement is audited',
  (select count(*)::text from public.audit_log
    where action = 'loan.disburse' and entity_id = '00000000-0000-0000-0000-0000000005f1'
      and actor_id = '00000000-0000-0000-0000-00000000005c' and after ->> 'status' = 'active'),
  '1');
select pg_temp.expect('the deduction receipt approval is audited with the CE',
  (select count(*)::text from public.audit_log a
     join public.receipt_items ri on ri.receipt_id = a.entity_id
    where a.action = 'receipt.approve' and ri.loan_id = '00000000-0000-0000-0000-0000000005f1'
      and a.reason = 'Deducciones del desembolso ' || :'ce'),
  '1');

-- cash_outflows: own rows, all for the admin roles, no writes from the browser.
select pg_temp.expect('the borrower sees their CE',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000005a', 'select 1 from public.cash_outflows'), '1');
select pg_temp.expect('another shareholder sees no CE',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000005b', 'select 1 from public.cash_outflows'), '0');
select pg_temp.expect('the gerente sees the CE',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000005d',
    $q$select 1 from public.cash_outflows where loan_id = '00000000-0000-0000-0000-0000000005f1'$q$), '1');
select pg_temp.expect('the tesorero cannot write cash_outflows from the browser',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000005c',
    $q$delete from public.cash_outflows$q$), 'denied');

-- RN-4.14: once the upfront shares are approved, the same loan can be disbursed.
insert into public.receipts (id, user_id, status, total_amount) values
  ('00000000-0000-0000-0000-0000000005e2', '00000000-0000-0000-0000-00000000005a', 'pending', 0);
insert into public.receipt_items (receipt_id, concept, target_month, share_count, unit_value, amount, loan_id) values
  ('00000000-0000-0000-0000-0000000005e2', 'acciones_prestamo', '2026-11-01', 2, 50000, 100000, '00000000-0000-0000-0000-0000000005f2');
update public.receipts set status = 'approved', reviewed_at = now(), reviewed_by = '00000000-0000-0000-0000-00000000005c'
 where id = '00000000-0000-0000-0000-0000000005e2';
select pg_temp.expect('approved upfront shares let the disbursement through',
  pg_temp.attempt('service_role', null,
    format($q$select public.desembolsar_prestamo('00000000-0000-0000-0000-0000000005f2', '00000000-0000-0000-0000-00000000005c', %L::jsonb, '[]', '[]')$q$, pg_temp.values_for(996000))),
  '1');
select pg_temp.expect('the upfront loan is active',
  (select status::text from public.loans where id = '00000000-0000-0000-0000-0000000005f2'), 'active');

rollback;
