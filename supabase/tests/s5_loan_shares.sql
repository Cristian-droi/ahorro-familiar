-- S5 T3 probes: loan shares exception (RN-4.12). Runs in one transaction and
-- rolls back.
--
-- docker exec -i supabase_db_app psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/s5_loan_shares.sql

begin;

create function pg_temp.attempt(p_sql text)
returns text
language plpgsql
as $$
declare
  n bigint;
  violated text;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n::text;
exception
  when check_violation then
    get stacked diagnostics violated = constraint_name;
    return 'check:' || violated;
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

insert into auth.users (id) values ('00000000-0000-0000-0000-00000000007a');
insert into public.profiles (id, first_name, identity_document, role) values
  ('00000000-0000-0000-0000-00000000007a', 'Ana', 'probe7-a', 'accionista');
insert into public.loans (id, user_id, requested_amount, status, loan_shares_count, loan_shares_amount) values
  ('00000000-0000-0000-0000-0000000007f1', '00000000-0000-0000-0000-00000000007a', 11000000, 'pending_review', 22, 1100000);

select pg_temp.expect('a changed count without a reason is refused',
  pg_temp.attempt($q$update public.loans set loan_shares_count = 20, loan_shares_suggested = 22 where id = '00000000-0000-0000-0000-0000000007f1'$q$),
  'check:loans_shares_override_has_reason');
select pg_temp.expect('a blank reason is refused',
  pg_temp.attempt($q$update public.loans set loan_shares_count = 20, loan_shares_suggested = 22, loan_shares_override_reason = '  ' where id = '00000000-0000-0000-0000-0000000007f1'$q$),
  'check:loans_shares_override_has_reason');
select pg_temp.expect('a changed count with a reason is stored',
  pg_temp.attempt($q$update public.loans set loan_shares_count = 20, loan_shares_amount = 1000000, loan_shares_suggested = 22, loan_shares_override_reason = 'Excepción aprobada' where id = '00000000-0000-0000-0000-0000000007f1'$q$),
  '1');
select pg_temp.expect('going back to the suggested count needs no reason',
  pg_temp.attempt($q$update public.loans set loan_shares_count = 22, loan_shares_amount = 1100000, loan_shares_override_reason = null where id = '00000000-0000-0000-0000-0000000007f1'$q$),
  '1');
select pg_temp.expect('a negative suggested count is refused',
  pg_temp.attempt($q$update public.loans set loan_shares_suggested = -1 where id = '00000000-0000-0000-0000-0000000007f1'$q$),
  'check:loans_loan_shares_suggested_check');

rollback;
