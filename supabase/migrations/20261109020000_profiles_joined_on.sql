-- S5 T2: joining date (RN-3.6). A shareholder owes shares and fines from the
-- month the membership is approved; when the approval falls after the grace
-- days, the fine of that month counts from the approval day.
--
-- Members created before this column, or by hand, keep null and owe from
-- January, as until now.

alter table public.profiles add column joined_on date;

comment on column public.profiles.joined_on is
  'RN-3.6: day (Bogota) the membership request was approved. Null: owes from January.';

-- A shareholder cannot move their own joining date. The tesorero keeps
-- profiles_update_admin_all.
drop policy profiles_update_self_limited on public.profiles;
create policy profiles_update_self_limited on public.profiles
  for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = (select p.role from public.profiles p where p.id = auth.uid())
    and identity_document = (select p.identity_document from public.profiles p where p.id = auth.uid())
    and admin_role is not distinct from (select p.admin_role from public.profiles p where p.id = auth.uid())
    and joined_on is not distinct from (select p.joined_on from public.profiles p where p.id = auth.uid())
  );
