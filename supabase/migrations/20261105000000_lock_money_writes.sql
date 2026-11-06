-- =============================================================================
-- S4: money writes only from the server.
--
-- Why:
--   - Tables older than August kept every privilege for `anon` and
--     `authenticated`, including TRUNCATE, which RLS does not check.
--   - Owner policies let a shareholder insert a loan with any status, rate or
--     balance, edit any column of their draft, and vote on their own loan.
--   - `votes_select_all` and `votes_admin_all` broke the secret vote (RN-4.9b).
--
-- What stays writable from the browser, on purpose (out of S4 scope):
--   `bank_accounts`, `capitalization_windows`, `membership_requests` and
--   `profiles` (UPDATE only). RLS still limits each of them.
--
-- Idempotent.
-- =============================================================================

-- 1. Direct write policies on money tables.
drop policy if exists "loans_insert_own" on public.loans;
drop policy if exists "loans_update_own_draft" on public.loans;
drop policy if exists "loans_admin_all" on public.loans;

drop policy if exists "plan_items_insert_draft" on public.loan_payment_plan_items;
drop policy if exists "plan_items_update_draft" on public.loan_payment_plan_items;
drop policy if exists "plan_items_delete_draft" on public.loan_payment_plan_items;

drop policy if exists "votes_insert_own" on public.loan_votes;
drop policy if exists "votes_admin_all" on public.loan_votes;

-- 2. Secret vote: each voter reads only their own vote (RN-4.9b).
drop policy if exists "votes_select_all" on public.loan_votes;
drop policy if exists "votes_select_own" on public.loan_votes;
create policy "votes_select_own" on public.loan_votes
  for select to authenticated
  using (voter_id = auth.uid());

-- 3. Table privileges. `service_role` is not touched.
revoke all on
  public.bank_accounts,
  public.capitalization_windows,
  public.email_change_requests,
  public.loan_payment_plan_items,
  public.loan_votes,
  public.loans,
  public.membership_requests,
  public.profiles,
  public.receipt_items,
  public.receipts,
  public.system_settings
from anon, authenticated;

grant select on
  public.email_change_requests,
  public.loan_payment_plan_items,
  public.loan_votes,
  public.loans,
  public.receipt_items,
  public.receipts,
  public.system_settings
to authenticated;

grant select, update on public.profiles to authenticated;

grant select, insert, update, delete on
  public.bank_accounts,
  public.capitalization_windows,
  public.membership_requests
to authenticated;

-- Public membership form.
grant insert on public.membership_requests to anon;

-- 4. Sequences are only used by triggers and the server.
revoke all on all sequences in schema public from anon, authenticated;

-- 5. Functions: nothing is callable without a session. `authenticated` keeps
-- what it had, because RLS policies and the app call these functions as that
-- role. Trigger functions need no EXECUTE to fire.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature, p.prorettype = 'trigger'::regtype as is_trigger
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and not exists (
        select 1 from pg_depend d
        where d.objid = p.oid and d.deptype = 'e'
      )
  loop
    execute format('revoke execute on function %s from public, anon', fn.signature);
    if not fn.is_trigger then
      execute format('grant execute on function %s to authenticated, service_role', fn.signature);
    end if;
  end loop;
end;
$$;

-- 6. Vote progress in totals, never who voted (RN-4.9b). Only for loans the
-- caller can already read.
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
    and (l.user_id = auth.uid() or l.status = 'pending_shareholder_vote' or public.is_admin())
  group by l.id;
$$;

revoke execute on function public.get_loan_vote_totals(uuid[]) from public, anon;
grant execute on function public.get_loan_vote_totals(uuid[]) to authenticated, service_role;
