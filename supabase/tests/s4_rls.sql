-- S4 security probes. Runs in one transaction against the local database and
-- rolls back, so it leaves no data behind. Any failed expectation raises.
--
-- docker exec -i supabase_db_app psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/s4_rls.sql

begin;

-- Runs p_sql as p_role with the JWT of p_uid. Returns the affected row count,
-- or 'denied' when the privilege check or an RLS check rejects it.
create function pg_temp.attempt(p_role text, p_uid uuid, p_sql text)
returns text
language plpgsql
as $$
declare
  n bigint;
  outcome text;
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

-- The server keeps its access.
select pg_temp.expect('service role writes loans',
  pg_temp.attempt('service_role', null,
    $q$update public.loans set interest_rate = interest_rate where id = '00000000-0000-0000-0000-0000000000f2'$q$), '1');

rollback;
