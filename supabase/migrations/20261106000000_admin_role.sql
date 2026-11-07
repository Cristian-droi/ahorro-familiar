-- S4 T2: administrative roles (roadmap S4, docs/modelo-datos.md).
--
-- admin_role is the only source of administrative authorization:
--   tesorero: reads and writes. is_admin() means exactly this.
--   gerente:  reads everything, writes nothing. has_admin_role() covers both.
-- profiles.role stays for now, because voting and utilities still count on it.
-- Authorization no longer reads it.

create type public.admin_role as enum ('gerente', 'tesorero');

alter table public.profiles add column admin_role public.admin_role;

comment on column public.profiles.admin_role is
  'Administrative role added to the shareholder one. Null means shareholder only.';

update public.profiles set admin_role = 'tesorero' where role = 'admin';

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and admin_role = 'tesorero'
  );
$$;

create function public.has_admin_role()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and admin_role is not null
  );
$$;

revoke all on function public.has_admin_role() from public, anon;
grant execute on function public.has_admin_role() to authenticated, service_role;

-- Nobody changes their own administrative role. Only the tesorero assigns it,
-- through profiles_update_admin_all.
drop policy profiles_update_self_limited on public.profiles;
create policy profiles_update_self_limited on public.profiles
  for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = (select p.role from public.profiles p where p.id = auth.uid())
    and identity_document = (select p.identity_document from public.profiles p where p.id = auth.uid())
    and admin_role is not distinct from (select p.admin_role from public.profiles p where p.id = auth.uid())
  );

-- Reads open to both roles. Write policies keep is_admin().
drop policy profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin on public.profiles
  for select using (id = auth.uid() or public.has_admin_role());

drop policy loans_select_own_or_voting on public.loans;
create policy loans_select_own_or_voting on public.loans
  for select using (
    user_id = auth.uid()
    or status = 'pending_shareholder_vote'
    or public.has_admin_role()
    or id in (select v.loan_id from public.loan_votes v where v.voter_id = auth.uid())
  );

drop policy plan_items_select on public.loan_payment_plan_items;
create policy plan_items_select on public.loan_payment_plan_items
  for select using (
    loan_id in (select l.id from public.loans l where l.user_id = auth.uid())
    or loan_id in (select l.id from public.loans l where l.status = 'pending_shareholder_vote')
    or public.has_admin_role()
  );

drop policy receipts_select_self_or_admin on public.receipts;
create policy receipts_select_self_or_admin on public.receipts
  for select using (user_id = auth.uid() or public.has_admin_role());

drop policy receipt_items_select_self_or_admin on public.receipt_items;
create policy receipt_items_select_self_or_admin on public.receipt_items
  for select using (
    exists (
      select 1 from public.receipts r
      where r.id = receipt_items.receipt_id
        and (r.user_id = auth.uid() or public.has_admin_role())
    )
  );

drop policy requests_select_admin on public.membership_requests;
create policy requests_select_admin on public.membership_requests
  for select using (public.has_admin_role());

drop policy period_memberships_select_own_or_admin on public.period_memberships;
create policy period_memberships_select_own_or_admin on public.period_memberships
  for select using (profile_id = auth.uid() or public.has_admin_role());

create policy capwindows_select_admin_role on public.capitalization_windows
  for select using (public.has_admin_role());

create policy payment_proofs_admin_role_read on storage.objects
  for select using (bucket_id = 'payment-proofs' and public.has_admin_role());

-- Vote totals: RN-4.9b says everyone sees the progress. A voter can still read a
-- loan after its voting closes, so the totals must follow.
create or replace function public.get_loan_vote_totals(p_loan_ids uuid[])
returns table (loan_id uuid, approved bigint, rejected bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.id,
    count(v.id) filter (where v.vote = 'approved'),
    count(v.id) filter (where v.vote = 'rejected')
  from public.loans l
  left join public.loan_votes v on v.loan_id = l.id
  where l.id = any(p_loan_ids)
    and (
      l.user_id = auth.uid()
      or l.status = 'pending_shareholder_vote'
      or public.has_admin_role()
      or exists (
        select 1 from public.loan_votes mine
        where mine.loan_id = l.id and mine.voter_id = auth.uid()
      )
    )
  group by l.id;
$$;

-- Read-only reports: same bodies, only the guard changes to has_admin_role().

CREATE OR REPLACE FUNCTION public.get_all_users_utilities_by_year(p_year integer)
 RETURNS TABLE(user_id uuid, month_number integer, participation numeric, utilities_pool numeric, distribution numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  m              integer;
  v_month_start  date;
  v_next_month   date;
BEGIN
  IF NOT public.has_admin_role() THEN
    RAISE EXCEPTION 'forbidden'
      USING HINT = 'Solo el administrador puede consultar utilidades consolidadas de los accionistas.';
  END IF;
  IF p_year IS NULL OR p_year < 2000 OR p_year > 2100 THEN
    RAISE EXCEPTION 'invalid_year';
  END IF;

  FOR m IN 1..12 LOOP
    v_month_start := make_date(p_year, m, 1);
    v_next_month  := (v_month_start + interval '1 month')::date;

    RETURN QUERY
    WITH active_profiles AS (
      SELECT id AS user_id FROM public.profiles WHERE role = 'accionista'
    ),
    user_acums AS (
      SELECT 
        r.user_id,
        COALESCE(SUM(ri.amount), 0) AS my_acum
      FROM public.receipts r
      JOIN public.receipt_items ri ON ri.receipt_id = r.id
      WHERE r.status = 'approved'
        AND ri.concept IN ('acciones', 'acciones_prestamo', 'capitalizacion')
        AND ri.target_month < v_next_month
      GROUP BY r.user_id
    ),
    total_acum AS (
      SELECT COALESCE(SUM(ri.amount), 0) AS total_acum
      FROM public.receipt_items ri
      JOIN public.receipts r ON r.id = ri.receipt_id
      WHERE r.status = 'approved'
        AND ri.concept IN ('acciones', 'acciones_prestamo', 'capitalizacion')
        AND ri.target_month < v_next_month
    ),
    pool AS (
      SELECT COALESCE(SUM(ri.amount), 0) AS pool_amount
      FROM public.receipt_items ri
      JOIN public.receipts r ON r.id = ri.receipt_id
      WHERE r.status = 'approved'
        AND ri.concept = 'pago_intereses'
        AND ri.target_month = v_month_start
    )
    SELECT 
      ap.user_id,
      m AS month_number,
      CASE 
        WHEN ta.total_acum > 0 THEN COALESCE(ua.my_acum, 0) / ta.total_acum
        ELSE 0
      END AS participation,
      p.pool_amount AS utilities_pool,
      CASE 
        WHEN ta.total_acum > 0 THEN ROUND((COALESCE(ua.my_acum, 0) / ta.total_acum) * p.pool_amount)
        ELSE 0
      END AS distribution
    FROM active_profiles ap
    LEFT JOIN user_acums ua ON ua.user_id = ap.user_id
    CROSS JOIN total_acum ta
    CROSS JOIN pool p;

  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_utilities_by_year(p_user_id uuid, p_year integer)
 RETURNS TABLE(month_number integer, participation numeric, utilities_pool numeric, distribution numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m              integer;
  v_month_start  date;
  v_next_month   date;
  v_my_acum      numeric;
  v_total_acum   numeric;
  v_pool         numeric;
  v_part         numeric;
begin
  if not public.has_admin_role() then
    raise exception 'forbidden'
      using hint = 'Solo el administrador puede consultar utilidades de otros accionistas.';
  end if;
  if p_user_id is null then raise exception 'invalid_user'; end if;
  if p_year is null or p_year < 2000 or p_year > 2100 then
    raise exception 'invalid_year';
  end if;

  for m in 1..12 loop
    v_month_start := make_date(p_year, m, 1);
    v_next_month  := (v_month_start + interval '1 month')::date;

    select coalesce(sum(ri.amount), 0)
      into v_my_acum
      from public.receipt_items ri
      join public.receipts r on r.id = ri.receipt_id
     where r.status   = 'approved'
       and r.user_id  = p_user_id
       and ri.concept in ('acciones', 'acciones_prestamo', 'capitalizacion')
       and ri.target_month < v_next_month;

    select coalesce(sum(ri.amount), 0)
      into v_total_acum
      from public.receipt_items ri
      join public.receipts r on r.id = ri.receipt_id
     where r.status   = 'approved'
       and ri.concept in ('acciones', 'acciones_prestamo', 'capitalizacion')
       and ri.target_month < v_next_month;

    select coalesce(sum(ri.amount), 0)
      into v_pool
      from public.receipt_items ri
      join public.receipts r on r.id = ri.receipt_id
     where r.status   = 'approved'
       and ri.concept = 'pago_intereses'
       and ri.target_month = v_month_start;

    if v_total_acum > 0 then
      v_part := v_my_acum / v_total_acum;
    else
      v_part := 0;
    end if;

    month_number   := m;
    participation  := v_part;
    utilities_pool := v_pool;
    distribution   := round(v_part * v_pool);
    return next;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_capitalization_windows_admin()
 RETURNS TABLE(id uuid, scope text, user_id uuid, user_name text, user_document text, max_amount bigint, used_amount bigint, remaining bigint, deadline date, opened_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.has_admin_role() then
    raise exception 'forbidden';
  end if;

  return query
  with active as (
    select w.*
      from public.capitalization_windows w
     where w.closed_at is null
  ),
  used_by_user as (
    select w.id as window_id,
           coalesce(sum(ri.amount), 0)::bigint as used
      from active w
      left join public.receipts r
        on (w.scope = 'global' or r.user_id = w.user_id)
       and r.status in ('pending', 'approved')
       and r.created_at >= w.opened_at
      left join public.receipt_items ri
        on ri.receipt_id = r.id
       and ri.concept = 'capitalizacion'
     where w.scope = 'user'
     group by w.id
  )
  select
    a.id,
    a.scope,
    a.user_id,
    case when p.id is not null then trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')) end as user_name,
    p.identity_document as user_document,
    a.max_amount,
    coalesce(u.used, 0)::bigint as used_amount,
    case when a.scope = 'user' then greatest(a.max_amount - coalesce(u.used, 0), 0)::bigint end as remaining,
    a.deadline,
    a.opened_at
  from active a
  left join public.profiles p on p.id = a.user_id
  left join used_by_user u on u.window_id = a.id
  order by a.scope desc, a.opened_at desc;
end;
$function$;
