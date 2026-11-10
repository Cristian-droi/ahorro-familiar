-- S5 T2 probes: joining date (RN-3.6). Runs in one transaction and rolls back.
--
-- docker exec -i supabase_db_app psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/s5_joined_on.sql

begin;

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

insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000006a'),
  ('00000000-0000-0000-0000-00000000006c');

insert into public.profiles (id, first_name, identity_document, role, joined_on) values
  ('00000000-0000-0000-0000-00000000006a', 'Ana', 'probe6-a', 'accionista', '2026-08-20'),
  ('00000000-0000-0000-0000-00000000006c', 'Tere', 'probe6-c', 'admin', null);
update public.profiles set admin_role = 'tesorero' where id = '00000000-0000-0000-0000-00000000006c';

select pg_temp.expect('a shareholder cannot move their joining date',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000006a',
    $q$update public.profiles set joined_on = '2026-12-01' where id = '00000000-0000-0000-0000-00000000006a'$q$),
  'denied');
select pg_temp.expect('the joining date did not change',
  (select joined_on::text from public.profiles where id = '00000000-0000-0000-0000-00000000006a'), '2026-08-20');
select pg_temp.expect('a shareholder still edits their own phone',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000006a',
    $q$update public.profiles set phone = '3000000000' where id = '00000000-0000-0000-0000-00000000006a'$q$),
  '1');
select pg_temp.expect('the tesorero can correct a joining date',
  pg_temp.attempt('authenticated', '00000000-0000-0000-0000-00000000006c',
    $q$update public.profiles set joined_on = '2026-08-19' where id = '00000000-0000-0000-0000-00000000006a'$q$),
  '1');

rollback;
