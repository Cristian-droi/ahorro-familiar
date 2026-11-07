-- S4 security probes. Runs in one transaction against the local database and
-- rolls back, so it leaves no data behind. Any failed expectation raises.
--
-- docker exec -i supabase_db_app psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/s4_rls.sql

begin;

-- Runs p_sql as p_role with the JWT of p_uid. Returns the affected row count,
-- 'denied' when the privilege check or an RLS check rejects it,
-- 'check:<constraint>' when a CHECK constraint rejects it, or
-- 'raised:<message>' when a guard in a function raises.
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

-- Fixtures: two shareholders, a tesorero, a gerente, a loan in voting, a draft
-- and a loan whose voting already closed.
insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000b'),
  ('00000000-0000-0000-0000-00000000000c'),
  ('00000000-0000-0000-0000-00000000000d');

insert into public.profiles (id, first_name, identity_document, role) values
  ('00000000-0000-0000-0000-00000000000a', 'Ana', 'probe-a', 'accionista'),
  ('00000000-0000-0000-0000-00000000000b', 'Beto', 'probe-b', 'accionista'),
  ('00000000-0000-0000-0000-00000000000c', 'Tere', 'probe-c', 'admin'),
  ('00000000-0000-0000-0000-00000000000d', 'Gere', 'probe-d', 'accionista');

update public.profiles set admin_role = 'tesorero' where id = '00000000-0000-0000-0000-00000000000c';
update public.profiles set admin_role = 'gerente' where id = '00000000-0000-0000-0000-00000000000d';

insert into public.loans (id, user_id, requested_amount, status) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000000a', 1000000, 'pending_shareholder_vote'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000000a', 1000000, 'draft'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-00000000000a', 1000000, 'rejected_by_shareholders');

insert into public.loan_votes (loan_id, voter_id, vote) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000000b', 'approved'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000000c', 'rejected'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-00000000000b', 'rejected');

-- anon: only the public membership form.
select pg_temp.expect('anon cannot truncate loans',
  pg_temp.attempt('anon', null, 'truncate public.loans cascade'), 'denied');
select pg_temp.expect('anon cannot truncate receipts',
  pg_temp.attempt('anon', null, 'truncate public.receipts cascade'), 'denied');
select pg_temp.expect('anon cannot read loans',
  pg_temp.attempt('anon', null, 'select * from public.loans'), 'denied');
select pg_temp.expect('anon cannot read profiles',
  pg_temp.attempt('anon', null, 'select * from public.profiles'), 'denied');
select pg_temp.expect('anon cannot use the loan number sequence',
  pg_temp.attempt('anon', null, $q$select nextval('public.loan_number_seq')$q$), 'denied');
-- Function privileges are read from the catalog. Calling a denied function from
-- a psql session after SET ROLE segfaults the local Postgres image (seen on
-- 2026-11-05); the same call through PostgREST answers 401 and does not crash.
select pg_temp.expect('anon cannot call any non-trigger public function',
  (select count(*)::text
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind = 'f'
     and p.prorettype <> 'trigger'::regtype
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and has_function_privilege('anon', p.oid, 'execute')), '0');
select pg_temp.expect('authenticated keeps get_cash_balance',
  has_function_privilege('authenticated', 'public.get_cash_balance()', 'execute')::text, 'true');
select pg_temp.expect('anon still submits the membership form',
  pg_temp.attempt('anon', null, $q$
    insert into public.membership_requests
      (first_name, last_name, phone, email, address, identity_document, monthly_income)
    values ('P', 'R', '3000000000', 'probe@example.test', 'Calle 1', 'probe-form', 1000000)
  $q$), '1');
select pg_temp.expect('anon cannot read the membership form back',
  pg_temp.attempt('anon', null, 'select * from public.membership_requests'), 'denied');

-- Shareholder: no direct money writes, even on their own draft (S1, S2).
select pg_temp.expect('shareholder cannot insert a loan',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000a', $q$
    insert into public.loans (user_id, requested_amount, status, outstanding_balance)
    values ('00000000-0000-0000-0000-00000000000a', 5000000, 'active', 0)
  $q$), 'denied');
select pg_temp.expect('shareholder cannot update their own draft',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000a',
    $q$update public.loans set interest_rate = 0 where id = '00000000-0000-0000-0000-0000000000f2'$q$), 'denied');
select pg_temp.expect('shareholder cannot write plan items',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000a',
    $q$delete from public.loan_payment_plan_items where loan_id = '00000000-0000-0000-0000-0000000000f2'$q$), 'denied');
select pg_temp.expect('applicant cannot vote directly',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000a', $q$
    insert into public.loan_votes (loan_id, voter_id, vote)
    values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000000a', 'approved')
  $q$), 'denied');
select pg_temp.expect('shareholder cannot insert receipts',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000a',
    $q$insert into public.receipts (user_id) values ('00000000-0000-0000-0000-00000000000a')$q$), 'denied');
select pg_temp.expect('shareholder cannot truncate loans',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000a', 'truncate public.loans cascade'), 'denied');
select pg_temp.expect('shareholder cannot change settings',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000a',
    $q$update public.system_settings set value = '1'$q$), 'denied');

-- Admin: money writes go through the server too.
select pg_temp.expect('admin cannot insert a loan directly',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000c', $q$
    insert into public.loans (user_id, requested_amount)
    values ('00000000-0000-0000-0000-00000000000c', 5000000)
  $q$), 'denied');
select pg_temp.expect('admin cannot update a loan directly',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000c',
    $q$update public.loans set outstanding_balance = 1$q$), 'denied');
select pg_temp.expect('admin cannot edit votes',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000c',
    $q$update public.loan_votes set vote = 'approved'$q$), 'denied');

-- Reads the app relies on keep working.
select pg_temp.expect('admin reads every loan',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000c',
    $q$select * from public.loans where id in ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2')$q$), '2');
select pg_temp.expect('voter reads the loan in voting but not the draft',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000b',
    $q$select * from public.loans where id in ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2')$q$), '1');

-- Secret vote (S3, RN-4.9b).
select pg_temp.expect('voter sees only their own vote',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000b',
    $q$select * from public.loan_votes where loan_id = '00000000-0000-0000-0000-0000000000f1'$q$), '1');
select pg_temp.expect('applicant sees no votes',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000a',
    $q$select * from public.loan_votes where loan_id = '00000000-0000-0000-0000-0000000000f1'$q$), '0');
select pg_temp.expect('admin sees only their own vote',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000c',
    $q$select * from public.loan_votes where loan_id = '00000000-0000-0000-0000-0000000000f1'$q$), '1');

-- Vote totals: everyone who can see the loan gets totals, and only totals.
select pg_temp.expect('totals: the applicant gets 1 approved and 1 rejected',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000a',
    $q$select * from public.get_loan_vote_totals(array['00000000-0000-0000-0000-0000000000f1']::uuid[]) where approved = 1 and rejected = 1$q$), '1');
select pg_temp.expect('totals: the function has no column naming the voter',
  (select count(*)::text from unnest((select proargnames from pg_proc where oid = 'public.get_loan_vote_totals(uuid[])'::regprocedure)) as a(name)
   where a.name like '%voter%'), '0');
select pg_temp.expect('totals: a loan without votes returns zero',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000a',
    $q$select * from public.get_loan_vote_totals(array['00000000-0000-0000-0000-0000000000f2']::uuid[]) where approved = 0 and rejected = 0$q$), '1');
select pg_temp.expect('totals: hidden for a loan the caller cannot see',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000b',
    $q$select * from public.get_loan_vote_totals(array['00000000-0000-0000-0000-0000000000f2']::uuid[])$q$), '0');

select pg_temp.expect('totals: a voter still gets them after voting closes',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000b',
    $q$select * from public.get_loan_vote_totals(array['00000000-0000-0000-0000-0000000000f3']::uuid[]) where rejected = 1$q$), '1');

-- admin_role (S4, S5): the gerente reads everything and writes nothing.
select pg_temp.expect('is_admin is true for the tesorero',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000c',
    $q$select 1 where public.is_admin()$q$), '1');
select pg_temp.expect('is_admin is false for the gerente',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000d',
    $q$select 1 where public.is_admin()$q$), '0');
select pg_temp.expect('has_admin_role is true for the gerente',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000d',
    $q$select 1 where public.has_admin_role()$q$), '1');
select pg_temp.expect('has_admin_role is false for a shareholder',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000a',
    $q$select 1 where public.has_admin_role()$q$), '0');
select pg_temp.expect('anon cannot use has_admin_role',
  has_function_privilege('anon', 'public.has_admin_role()', 'execute')::text, 'false');
select pg_temp.expect('gerente reads every loan',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000d',
    $q$select * from public.loans where id in ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2')$q$), '2');
select pg_temp.expect('gerente reads every profile',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000d',
    $q$select * from public.profiles where identity_document like 'probe-%'$q$), '4');
select pg_temp.expect('gerente gets vote totals on a draft',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000d',
    $q$select * from public.get_loan_vote_totals(array['00000000-0000-0000-0000-0000000000f2']::uuid[])$q$), '1');
select pg_temp.expect('gerente sees no individual votes',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000d',
    $q$select * from public.loan_votes where loan_id = '00000000-0000-0000-0000-0000000000f1'$q$), '0');
select pg_temp.expect('gerente cannot update another profile',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000d',
    $q$update public.profiles set phone = '1' where id = '00000000-0000-0000-0000-00000000000a'$q$), '0');
select pg_temp.expect('gerente cannot update a loan',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000d',
    $q$update public.loans set outstanding_balance = 1$q$), 'denied');
select pg_temp.expect('gerente cannot delete bank accounts',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000d',
    'delete from public.bank_accounts'), '0');
select pg_temp.expect('gerente cannot change membership requests',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000d',
    $q$update public.membership_requests set first_name = 'X'$q$), '0');

-- Nobody grants themselves an administrative role.
select pg_temp.expect('shareholder cannot make themselves tesorero',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000a',
    $q$update public.profiles set admin_role = 'tesorero' where id = '00000000-0000-0000-0000-00000000000a'$q$), 'denied');
select pg_temp.expect('gerente cannot make themselves tesorero',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000d',
    $q$update public.profiles set admin_role = 'tesorero' where id = '00000000-0000-0000-0000-00000000000d'$q$), 'denied');
select pg_temp.expect('shareholder still updates their own phone',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000a',
    $q$update public.profiles set phone = '3001234567' where id = '00000000-0000-0000-0000-00000000000a'$q$), '1');

-- Payment proofs: readable by both roles, writable only by the tesorero.
select pg_temp.expect('storage: gerente may read payment proofs, without write policies',
  (select count(*)::text from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname = 'payment_proofs_admin_role_read' and cmd = 'SELECT'
     and qual like '%has_admin_role%'), '1');

-- RN-4.29: no loan ends with a negative balance, on any path.
insert into public.loans (id, user_id, requested_amount, status, outstanding_balance, disbursed_at, full_rate_day_limit, cutoff_day) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 100000, 'active', 100000, now(), 15, 25),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000a', 100000, 'active', 100000, now(), 15, 25),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-00000000000a', 100000, 'active', 100000, now(), 15, 25);

insert into public.receipts (id, user_id) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-00000000000a');

insert into public.receipt_items (receipt_id, concept, target_month, amount, loan_id) values
  ('00000000-0000-0000-0000-0000000000b1', 'pago_capital', date_trunc('month', now())::date, 100001, '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b2', 'pago_capital', date_trunc('month', now())::date, 100000, '00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000000b3', 'pago_capital', date_trunc('month', now())::date, 40000, '00000000-0000-0000-0000-0000000000a3');

select pg_temp.expect('a negative balance is rejected even for the server',
  pg_temp.attempt('service_role', null,
    $q$update public.loans set outstanding_balance = -1 where id = '00000000-0000-0000-0000-0000000000a1'$q$), 'check:loans_outstanding_balance_not_negative');
select pg_temp.expect('negative deducted interest is rejected',
  pg_temp.attempt('service_role', null,
    $q$update public.loans set deducted_interest_amount = -1 where id = '00000000-0000-0000-0000-0000000000a1'$q$), 'check:loans_deducted_interest_not_negative');
select pg_temp.expect('approving a capital payment above the balance is rejected, not clamped',
  pg_temp.attempt('service_role', null,
    $q$update public.receipts set status = 'approved', reviewed_at = now(), reviewed_by = '00000000-0000-0000-0000-00000000000c' where id = '00000000-0000-0000-0000-0000000000b1'$q$), 'check:loans_outstanding_balance_not_negative');
select pg_temp.expect('the rejected approval leaves the balance untouched',
  (select outstanding_balance::text from public.loans where id = '00000000-0000-0000-0000-0000000000a1'), '100000');
select pg_temp.expect('the rejected approval leaves the receipt pending',
  (select status::text from public.receipts where id = '00000000-0000-0000-0000-0000000000b1'), 'pending');
select pg_temp.expect('paying the exact balance is approved',
  pg_temp.attempt('service_role', null,
    $q$update public.receipts set status = 'approved', reviewed_at = now(), reviewed_by = '00000000-0000-0000-0000-00000000000c' where id = '00000000-0000-0000-0000-0000000000b2'$q$), '1');
select pg_temp.expect('paying the exact balance leaves the loan paid at zero (RN-4.28)',
  (select outstanding_balance || ' ' || status from public.loans where id = '00000000-0000-0000-0000-0000000000a2'), '0 paid');
select pg_temp.expect('a partial capital payment is approved',
  pg_temp.attempt('service_role', null,
    $q$update public.receipts set status = 'approved', reviewed_at = now(), reviewed_by = '00000000-0000-0000-0000-00000000000c' where id = '00000000-0000-0000-0000-0000000000b3'$q$), '1');
select pg_temp.expect('a partial capital payment lowers the balance and keeps the loan active',
  (select outstanding_balance || ' ' || status from public.loans where id = '00000000-0000-0000-0000-0000000000a3'), '60000 active');

-- audit_log (S8, S9, RN-9). The change and its record live or die together.
select pg_temp.expect('audit: the server updates a loan and records it',
  pg_temp.attempt('service_role', null, $q$
    select public.apply_audited_update('loans', '00000000-0000-0000-0000-0000000000f2',
      '{"admin_notes": "revisado"}'::jsonb, '00000000-0000-0000-0000-00000000000c', 'loan.plan_approve', 'draft', 'porque si')
  $q$), '1');
select pg_temp.expect('audit: the change was applied',
  (select admin_notes from public.loans where id = '00000000-0000-0000-0000-0000000000f2'), 'revisado');
select pg_temp.expect('audit: who, what, reason, before and after (RN-9.2)',
  (select actor_id::text || '|' || action || '|' || entity || '|' || entity_id::text || '|' || reason || '|' || (before ? 'admin_notes') || '|' || (after ->> 'admin_notes') || '|' || is_self_action
   from public.audit_log where action = 'loan.plan_approve'),
  '00000000-0000-0000-0000-00000000000c|loan.plan_approve|loans|00000000-0000-0000-0000-0000000000f2|porque si|true|revisado|false');
select pg_temp.expect('audit: an action on your own loan is marked (RN-9.4)',
  pg_temp.attempt('service_role', null, $q$
    select public.apply_audited_update('loans', '00000000-0000-0000-0000-0000000000f2',
      '{"admin_notes": "propio"}'::jsonb, '00000000-0000-0000-0000-00000000000a', 'loan.self_check', 'draft', null)
  $q$), '1');
select pg_temp.expect('audit: the self action flag is stored',
  (select is_self_action::text from public.audit_log where action = 'loan.self_check'), 'true');

-- Same overpayment as RN-4.29 above, now through the audited path.
insert into public.receipts (id, user_id) values
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-00000000000a');
insert into public.receipt_items (receipt_id, concept, target_month, amount, loan_id) values
  ('00000000-0000-0000-0000-0000000000b4', 'pago_capital', date_trunc('month', now())::date, 999999, '00000000-0000-0000-0000-0000000000a3');
select pg_temp.expect('audit: a rejected change leaves no record and no change',
  pg_temp.attempt('service_role', null, $q$
    select public.apply_audited_update('receipts', '00000000-0000-0000-0000-0000000000b4',
      '{"status": "approved", "reviewed_at": "2026-11-06T10:00:00Z", "reviewed_by": "00000000-0000-0000-0000-00000000000c"}'::jsonb,
      '00000000-0000-0000-0000-00000000000c', 'receipt.overpaid', 'pending', null)
  $q$), 'check:loans_outstanding_balance_not_negative');
select pg_temp.expect('audit: no record of the rejected change',
  (select count(*)::text from public.audit_log where action = 'receipt.overpaid'), '0');
select pg_temp.expect('audit: the receipt stayed pending',
  (select status::text from public.receipts where id = '00000000-0000-0000-0000-0000000000b4'), 'pending');
insert into public.receipts (id, user_id) values
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-00000000000a');
insert into public.receipt_items (receipt_id, concept, target_month, amount, loan_id) values
  ('00000000-0000-0000-0000-0000000000b5', 'pago_capital', date_trunc('month', now())::date, 10000, '00000000-0000-0000-0000-0000000000a3');
select pg_temp.expect('audit: an approval through the audited path is recorded',
  pg_temp.attempt('service_role', null, $q$
    select public.apply_audited_update('receipts', '00000000-0000-0000-0000-0000000000b5',
      '{"status": "approved", "reviewed_at": "2026-11-06T10:00:00Z", "reviewed_by": "00000000-0000-0000-0000-00000000000c"}'::jsonb,
      '00000000-0000-0000-0000-00000000000c', 'receipt.approve', 'pending', null)
  $q$), '1');
select pg_temp.expect('audit: that approval still lowers the balance through the trigger',
  (select outstanding_balance::text from public.loans where id = '00000000-0000-0000-0000-0000000000a3'), '50000');
select pg_temp.expect('audit: approving someone else''s receipt is not marked as your own',
  (select is_self_action::text from public.audit_log
   where action = 'receipt.approve' and entity_id = '00000000-0000-0000-0000-0000000000b5'), 'false');

-- F18: a review applies only to the status the route read, so two reviews of one
-- receipt cannot both go through.
insert into public.loans (id, user_id, requested_amount, status, outstanding_balance, disbursed_at, full_rate_day_limit, cutoff_day) values
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-00000000000a', 100000, 'active', 100000, now(), 15, 25);
insert into public.receipts (id, user_id) values
  ('00000000-0000-0000-0000-0000000000b6', '00000000-0000-0000-0000-00000000000a');
insert into public.receipt_items (receipt_id, concept, target_month, amount, loan_id) values
  ('00000000-0000-0000-0000-0000000000b6', 'pago_capital', date_trunc('month', now())::date, 10000, '00000000-0000-0000-0000-0000000000a4');
select pg_temp.expect('F18: the first review of a pending receipt goes through',
  pg_temp.attempt('service_role', null, $q$
    select public.apply_audited_update('receipts', '00000000-0000-0000-0000-0000000000b6',
      '{"status": "approved", "reviewed_at": "2026-11-06T10:00:00Z", "reviewed_by": "00000000-0000-0000-0000-00000000000c"}'::jsonb,
      '00000000-0000-0000-0000-00000000000c', 'receipt.f18_first', 'pending', null)
  $q$), '1');
select pg_temp.expect('F18: approved then rejected is refused',
  pg_temp.attempt('service_role', null, $q$
    select public.apply_audited_update('receipts', '00000000-0000-0000-0000-0000000000b6',
      '{"status": "rejected", "reviewed_at": "2026-11-06T10:00:00Z", "reviewed_by": "00000000-0000-0000-0000-00000000000c", "rejection_reason": "amount_mismatch"}'::jsonb,
      '00000000-0000-0000-0000-00000000000c', 'receipt.f18_second', 'pending', null)
  $q$), 'raised:audit_status_conflict');
select pg_temp.expect('F18: the receipt stays approved',
  (select status::text from public.receipts where id = '00000000-0000-0000-0000-0000000000b6'), 'approved');
select pg_temp.expect('F18: the refused review leaves no record',
  (select count(*)::text from public.audit_log where action = 'receipt.f18_second'), '0');
select pg_temp.expect('F18: the payment lowered the balance once',
  (select outstanding_balance::text from public.loans where id = '00000000-0000-0000-0000-0000000000a4'), '90000');

insert into public.receipts (id, user_id) values
  ('00000000-0000-0000-0000-0000000000b7', '00000000-0000-0000-0000-00000000000a');
insert into public.receipt_items (receipt_id, concept, target_month, amount, loan_id) values
  ('00000000-0000-0000-0000-0000000000b7', 'pago_capital', date_trunc('month', now())::date, 10000, '00000000-0000-0000-0000-0000000000a4');
select pg_temp.expect('F18: a pending receipt can be rejected',
  pg_temp.attempt('service_role', null, $q$
    select public.apply_audited_update('receipts', '00000000-0000-0000-0000-0000000000b7',
      '{"status": "rejected", "reviewed_at": "2026-11-06T10:00:00Z", "reviewed_by": "00000000-0000-0000-0000-00000000000c", "rejection_reason": "amount_mismatch"}'::jsonb,
      '00000000-0000-0000-0000-00000000000c', 'receipt.f18_reject', 'pending', null)
  $q$), '1');
select pg_temp.expect('F18: rejected then approved is refused',
  pg_temp.attempt('service_role', null, $q$
    select public.apply_audited_update('receipts', '00000000-0000-0000-0000-0000000000b7',
      '{"status": "approved", "reviewed_at": "2026-11-06T10:00:00Z", "reviewed_by": "00000000-0000-0000-0000-00000000000c", "rejection_reason": null}'::jsonb,
      '00000000-0000-0000-0000-00000000000c', 'receipt.f18_late', 'pending', null)
  $q$), 'raised:audit_status_conflict');
select pg_temp.expect('F18: the receipt stays rejected',
  (select status::text from public.receipts where id = '00000000-0000-0000-0000-0000000000b7'), 'rejected');
select pg_temp.expect('F18: the late approval does not subtract again',
  (select outstanding_balance::text from public.loans where id = '00000000-0000-0000-0000-0000000000a4'), '90000');
select pg_temp.expect('F18: a loan is guarded the same way',
  pg_temp.attempt('service_role', null, $q$
    select public.apply_audited_update('loans', '00000000-0000-0000-0000-0000000000f2',
      '{"admin_notes": "tarde"}'::jsonb, '00000000-0000-0000-0000-00000000000c', 'loan.f18_late', 'pending_review', null)
  $q$), 'raised:audit_status_conflict');
select pg_temp.expect('F18: the guarded loan keeps its value',
  (select admin_notes from public.loans where id = '00000000-0000-0000-0000-0000000000f2'), 'propio');
select pg_temp.expect('F18: a missing expected status is refused, not skipped',
  pg_temp.attempt('service_role', null, $q$
    select public.apply_audited_update('loans', '00000000-0000-0000-0000-0000000000f2',
      '{"admin_notes": "sin estado"}'::jsonb, '00000000-0000-0000-0000-00000000000c', 'loan.f18_null', null, null)
  $q$), 'raised:audit_status_conflict');
select pg_temp.expect('F18: only the guarded version of the writer exists',
  (select count(*)::text from pg_proc where proname = 'apply_audited_update'), '1');

-- F24: resubmitting replaces the items and reopens the receipt in one transaction,
-- and only from rejected. A stale resubmit cannot reopen an approved receipt.
insert into public.loans (id, user_id, requested_amount, status, outstanding_balance, disbursed_at, full_rate_day_limit, cutoff_day) values
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-00000000000a', 100000, 'active', 100000, now(), 15, 25);
insert into public.receipts (id, user_id) values
  ('00000000-0000-0000-0000-0000000000b8', '00000000-0000-0000-0000-00000000000a');
insert into public.receipt_items (receipt_id, concept, target_month, amount, loan_id) values
  ('00000000-0000-0000-0000-0000000000b8', 'pago_capital', date_trunc('month', now())::date, 10000, '00000000-0000-0000-0000-0000000000a5');
select public.apply_audited_update('receipts', '00000000-0000-0000-0000-0000000000b8',
  '{"status": "rejected", "reviewed_at": "2026-11-06T10:00:00Z", "reviewed_by": "00000000-0000-0000-0000-00000000000c", "rejection_reason": "amount_mismatch"}'::jsonb,
  '00000000-0000-0000-0000-00000000000c', 'receipt.reject', 'pending', null);

select pg_temp.expect('F24: only the owner can resubmit',
  pg_temp.attempt('service_role', null, $q$
    select public.resubmit_receipt('00000000-0000-0000-0000-0000000000b8', '00000000-0000-0000-0000-00000000000b',
      jsonb_build_array(jsonb_build_object('concept', 'pago_capital', 'target_month', date_trunc('month', now())::date, 'amount', 25000, 'loan_id', '00000000-0000-0000-0000-0000000000a5', 'auto_generated', false)),
      '{"status": "pending", "submitted_at": "2026-11-06T11:00:00Z", "reviewed_at": null, "reviewed_by": null, "rejection_reason": null, "rejection_note": null, "payment_method": "cash", "bank_account_id": null, "payment_proof_path": null}'::jsonb)
  $q$), 'raised:resubmit_not_owner');
select pg_temp.expect('F24: a bad item is refused',
  pg_temp.attempt('service_role', null, $q$
    select public.resubmit_receipt('00000000-0000-0000-0000-0000000000b8', '00000000-0000-0000-0000-00000000000a',
      jsonb_build_array(
        jsonb_build_object('concept', 'pago_capital', 'target_month', date_trunc('month', now())::date, 'amount', 25000, 'loan_id', '00000000-0000-0000-0000-0000000000a5', 'auto_generated', false),
        jsonb_build_object('concept', 'pago_capital', 'target_month', date_trunc('month', now())::date, 'amount', 25000, 'loan_id', '00000000-0000-0000-0000-0000000000f2', 'auto_generated', false)),
      '{"status": "pending", "submitted_at": "2026-11-06T11:00:00Z", "reviewed_at": null, "reviewed_by": null, "rejection_reason": null, "rejection_note": null, "payment_method": "cash", "bank_account_id": null, "payment_proof_path": null}'::jsonb)
  $q$), 'raised:loan_not_active');
select pg_temp.expect('F24: the refused resubmit keeps the old items and status',
  (select r.status::text || ' ' || count(i.id) || ' ' || sum(i.amount) || ' ' || r.total_amount
   from public.receipts r join public.receipt_items i on i.receipt_id = r.id
   where r.id = '00000000-0000-0000-0000-0000000000b8' group by r.id), 'rejected 1 10000 10000');
select pg_temp.expect('F24: a rejected receipt can be resubmitted',
  pg_temp.attempt('service_role', null, $q$
    select public.resubmit_receipt('00000000-0000-0000-0000-0000000000b8', '00000000-0000-0000-0000-00000000000a',
      jsonb_build_array(jsonb_build_object('concept', 'pago_capital', 'target_month', date_trunc('month', now())::date, 'amount', 25000, 'loan_id', '00000000-0000-0000-0000-0000000000a5', 'auto_generated', false)),
      '{"status": "pending", "submitted_at": "2026-11-06T11:00:00Z", "reviewed_at": null, "reviewed_by": null, "rejection_reason": null, "rejection_note": null, "payment_method": "cash", "bank_account_id": null, "payment_proof_path": null}'::jsonb)
  $q$), '1');
select pg_temp.expect('F24: the items were replaced and the total follows them',
  (select r.status::text || ' ' || count(i.id) || ' ' || sum(i.amount) || ' ' || r.total_amount
   from public.receipts r join public.receipt_items i on i.receipt_id = r.id
   where r.id = '00000000-0000-0000-0000-0000000000b8' group by r.id), 'pending 1 25000 25000');
select pg_temp.expect('F24: the review fields were cleared',
  (select (reviewed_at is null and reviewed_by is null and rejection_reason is null)::text
   from public.receipts where id = '00000000-0000-0000-0000-0000000000b8'), 'true');
select pg_temp.expect('F24: the resubmit is recorded once, by its owner',
  (select count(*) || ' ' || min(actor_id::text) from public.audit_log
   where action = 'receipt.resubmit' and entity_id = '00000000-0000-0000-0000-0000000000b8'),
  '1 00000000-0000-0000-0000-00000000000a');
select pg_temp.expect('F24: a second resubmit is refused',
  pg_temp.attempt('service_role', null, $q$
    select public.resubmit_receipt('00000000-0000-0000-0000-0000000000b8', '00000000-0000-0000-0000-00000000000a',
      jsonb_build_array(jsonb_build_object('concept', 'pago_capital', 'target_month', date_trunc('month', now())::date, 'amount', 30000, 'loan_id', '00000000-0000-0000-0000-0000000000a5', 'auto_generated', false)),
      '{"status": "pending", "submitted_at": "2026-11-06T11:00:00Z", "reviewed_at": null, "reviewed_by": null, "rejection_reason": null, "rejection_note": null, "payment_method": "cash", "bank_account_id": null, "payment_proof_path": null}'::jsonb)
  $q$), 'raised:audit_status_conflict');
select public.apply_audited_update('receipts', '00000000-0000-0000-0000-0000000000b8',
  '{"status": "approved", "reviewed_at": "2026-11-06T12:00:00Z", "reviewed_by": "00000000-0000-0000-0000-00000000000c"}'::jsonb,
  '00000000-0000-0000-0000-00000000000c', 'receipt.approve', 'pending', null);
select pg_temp.expect('F24: a stale resubmit cannot reopen an approved receipt',
  pg_temp.attempt('service_role', null, $q$
    select public.resubmit_receipt('00000000-0000-0000-0000-0000000000b8', '00000000-0000-0000-0000-00000000000a',
      jsonb_build_array(jsonb_build_object('concept', 'pago_capital', 'target_month', date_trunc('month', now())::date, 'amount', 30000, 'loan_id', '00000000-0000-0000-0000-0000000000a5', 'auto_generated', false)),
      '{"status": "pending", "submitted_at": "2026-11-06T11:00:00Z", "reviewed_at": null, "reviewed_by": null, "rejection_reason": null, "rejection_note": null, "payment_method": "cash", "bank_account_id": null, "payment_proof_path": null}'::jsonb)
  $q$), 'raised:audit_status_conflict');
select pg_temp.expect('F24: the approved receipt keeps its status and items',
  (select r.status::text || ' ' || sum(i.amount)
   from public.receipts r join public.receipt_items i on i.receipt_id = r.id
   where r.id = '00000000-0000-0000-0000-0000000000b8' group by r.id), 'approved 25000');
select pg_temp.expect('F24: the payment lowered the balance once',
  (select outstanding_balance::text from public.loans where id = '00000000-0000-0000-0000-0000000000a5'), '75000');
select pg_temp.expect('F24: the writer is for the server only',
  (has_function_privilege('authenticated', 'public.resubmit_receipt(uuid, uuid, jsonb, jsonb)', 'execute')
    or has_function_privilege('anon', 'public.resubmit_receipt(uuid, uuid, jsonb, jsonb)', 'execute'))::text, 'false');
select pg_temp.expect('F24: the server can call it',
  has_function_privilege('service_role', 'public.resubmit_receipt(uuid, uuid, jsonb, jsonb)', 'execute')::text, 'true');

-- F19: this function let any shareholder read the interest owed on any loan.
select pg_temp.expect('F19: get_loan_interest_owed no longer exists',
  (select count(*)::text from pg_proc where proname = 'get_loan_interest_owed'), '0');

-- Settings: one record per value that really changed.
insert into public.system_settings (key, value) values ('probe_audit', '1'::jsonb);
select pg_temp.expect('audit: settings are saved through the audited path',
  pg_temp.attempt('service_role', null, $q$
    select public.apply_audited_settings('[{"key": "probe_audit", "value": 2}, {"key": "probe_audit_new", "value": 5}]'::jsonb, '00000000-0000-0000-0000-00000000000c')
  $q$), '1');
select pg_temp.expect('audit: the setting changed',
  (select value::text from public.system_settings where key = 'probe_audit'), '2');
select pg_temp.expect('audit: the setting keeps its old and new value',
  (select (before ->> 'value') || '>' || (after ->> 'value') from public.audit_log where action = 'settings.update' and after ->> 'key' = 'probe_audit'), '1>2');
select pg_temp.expect('audit: saving the same value records nothing',
  pg_temp.attempt('service_role', null, $q$
    select public.apply_audited_settings('[{"key": "probe_audit", "value": 2}]'::jsonb, '00000000-0000-0000-0000-00000000000c')
  $q$), '1');
select pg_temp.expect('audit: still one record for that setting',
  (select count(*)::text from public.audit_log where action = 'settings.update' and after ->> 'key' = 'probe_audit'), '1');

-- Share value permission: a decision of the tesorero, from their own session.
insert into public.period_memberships (period_id, profile_id, share_value, share_value_locked_at)
  select id, '00000000-0000-0000-0000-00000000000a', 50000, now() from public.periods where status = 'open';
select pg_temp.expect('audit: the share value permission is recorded with the session actor',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000c', $q$
    select public.allow_share_value_change('00000000-0000-0000-0000-00000000000a', true)
  $q$), '1');
select pg_temp.expect('audit: the share value record names the session actor',
  (select actor_id::text || '|' || (after ->> 'share_value_change_allowed') from public.audit_log
   where action = 'share_value.allow' and entity_id = '00000000-0000-0000-0000-00000000000a'),
  '00000000-0000-0000-0000-00000000000c|true');

-- Only allowed tables and only real columns.
select pg_temp.expect('audit: only loans and receipts can be written this way',
  (select count(*)::text from pg_proc where proname = 'apply_audited_update'
     and prosrc like '%audit_entity_not_allowed%'), '1');
select pg_temp.expect('audit: the writers are for the server only',
  (has_function_privilege('authenticated', 'public.apply_audited_update(text, uuid, jsonb, uuid, text, text, text)', 'execute')
    or has_function_privilege('anon', 'public.apply_audited_update(text, uuid, jsonb, uuid, text, text, text)', 'execute')
    or has_function_privilege('authenticated', 'public.apply_audited_settings(jsonb, uuid)', 'execute')
    or has_function_privilege('anon', 'public.apply_audited_settings(jsonb, uuid)', 'execute'))::text, 'false');

-- Reading: the gerente and the tesorero only (docs/modelo-datos.md).
select pg_temp.expect('audit: anon cannot read it',
  pg_temp.attempt('anon', null, 'select * from public.audit_log'), 'denied');
select pg_temp.expect('audit: a shareholder sees nothing',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000b',
    $q$select * from public.audit_log where action = 'loan.plan_approve'$q$), '0');
select pg_temp.expect('audit: the gerente reads it',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000d',
    $q$select * from public.audit_log where action = 'loan.plan_approve'$q$), '1');
select pg_temp.expect('audit: the tesorero reads it',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000c',
    $q$select * from public.audit_log where action = 'loan.plan_approve'$q$), '1');

-- Append only, for every role (RN-9.3).
select pg_temp.expect('audit: nobody in the app inserts directly',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000c', $q$
    insert into public.audit_log (actor_id, action, entity) values ('00000000-0000-0000-0000-00000000000c', 'x', 'x')
  $q$), 'denied');
select pg_temp.expect('audit: the server does not insert directly either',
  pg_temp.attempt('service_role', null, $q$
    insert into public.audit_log (actor_id, action, entity) values ('00000000-0000-0000-0000-00000000000c', 'x', 'x')
  $q$), 'denied');
select pg_temp.expect('audit: postgres cannot update it',
  pg_temp.attempt('postgres', null, $q$update public.audit_log set reason = 'x'$q$), 'denied');
select pg_temp.expect('audit: postgres cannot delete from it',
  pg_temp.attempt('postgres', null, 'delete from public.audit_log'), 'denied');
select pg_temp.expect('audit: postgres cannot truncate it',
  pg_temp.attempt('postgres', null, 'truncate public.audit_log'), 'denied');

-- F28: internal helpers are not callable from the API.
select pg_temp.expect('shareholder cannot ask about another shareholder''s purchases',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000a',
    $q$select public.has_share_receipts_in_period('00000000-0000-0000-0000-00000000000b', (select id from public.periods where status = 'open'))$q$), 'denied');
select pg_temp.expect('shareholder cannot read the capitalization window helper',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000a',
    $q$select public.get_capitalization_window_state()$q$), 'denied');
select pg_temp.expect('service role keeps the purchases helper',
  pg_temp.attempt('service_role', null,
    $q$select public.has_share_receipts_in_period('00000000-0000-0000-0000-00000000000b', (select id from public.periods where status = 'open'))$q$), '1');

-- F28: the flows that use those helpers keep working from a session.
insert into public.system_settings (key, value) values ('allowed_share_values', '[10000, 25000]')
  on conflict (key) do update set value = excluded.value;
select pg_temp.expect('shareholder chooses a share value',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000b',
    $q$select public.choose_share_value(10000)$q$), '1');
select pg_temp.expect('tesorero enables a share value change',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000c',
    $q$select public.allow_share_value_change('00000000-0000-0000-0000-00000000000b', true)$q$), '1');
select pg_temp.expect('shareholder changes the share value through the trigger',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000000b',
    $q$select public.choose_share_value(25000)$q$), '1');
select pg_temp.expect('new share value stored',
  (select share_value::text from public.period_memberships
    where profile_id = '00000000-0000-0000-0000-00000000000b'
      and period_id = (select id from public.periods where status = 'open')), '25000');

-- F28: every public function has a fixed search_path.
select pg_temp.expect('no public function has a mutable search_path',
  (select count(*)::text
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')), '0');

-- The server keeps its access.
select pg_temp.expect('service role writes loans',
  pg_temp.attempt('service_role', null,
    $q$update public.loans set interest_rate = interest_rate where id = '00000000-0000-0000-0000-0000000000f2'$q$), '1');

rollback;
