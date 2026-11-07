-- S4 T4: immutable audit log (RN-9, docs/modelo-datos.md, section 4.9).
--
-- The record is written in the same transaction as the change
-- (docs/convenciones.md), so a change never exists without its record and a
-- record never exists without its change. Disbursement joins this in S5.

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid not null references public.profiles (id),
  action text not null,
  entity text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  reason text,
  is_self_action boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.audit_log is 'Append only (RN-9.3). Written only by the audited functions.';

create index audit_log_entity_idx on public.audit_log (entity, entity_id);
create index audit_log_actor_idx on public.audit_log (actor_id, created_at desc);
create index audit_log_created_at_idx on public.audit_log (created_at desc);

-- RN-9.3: no role may change history, not even the table owner.
create function public.reject_audit_log_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'audit_log_is_append_only' using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_log_no_update_or_delete
  before update or delete on public.audit_log
  for each row execute function public.reject_audit_log_change();

create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.reject_audit_log_change();

revoke all on function public.reject_audit_log_change() from public, anon, authenticated;

alter table public.audit_log enable row level security;

create policy audit_log_select_admin_role on public.audit_log
  for select using (public.has_admin_role());

revoke all on table public.audit_log from public, anon, authenticated, service_role;
grant select on table public.audit_log to authenticated, service_role;

-- Applies a partial update to a loan or a receipt and records it. Before and
-- after come from the row itself, limited to the columns that change. A failed
-- update, including a trigger or a CHECK, rolls the record back with it.
create function public.apply_audited_update(
  p_entity text,
  p_id uuid,
  p_patch jsonb,
  p_actor uuid,
  p_action text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_columns text;
  v_before jsonb;
  v_after jsonb;
begin
  if p_entity not in ('loans', 'receipts') then
    raise exception 'audit_entity_not_allowed';
  end if;

  select string_agg(format('%I', k), ', ') into v_columns
    from jsonb_object_keys(p_patch) as k;
  if v_columns is null then
    raise exception 'audit_empty_patch';
  end if;

  execute format('select to_jsonb(t) from public.%I t where t.id = $1 for update', p_entity)
    into v_row using p_id;
  if v_row is null then
    raise exception 'audit_entity_not_found';
  end if;

  select jsonb_object_agg(k, v_row -> k) into v_before
    from jsonb_object_keys(p_patch) as k;

  execute format(
    'update public.%1$I t set (%2$s) = (select %2$s from jsonb_populate_record(null::public.%1$I, $1)) where t.id = $2 returning to_jsonb(t)',
    p_entity, v_columns
  ) into v_row using p_patch, p_id;

  select jsonb_object_agg(k, v_row -> k) into v_after
    from jsonb_object_keys(p_patch) as k;

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after, reason, is_self_action)
  values (p_actor, p_action, p_entity, p_id, v_before, v_after, p_reason, (v_row ->> 'user_id')::uuid = p_actor);
end;
$$;

revoke all on function public.apply_audited_update(text, uuid, jsonb, uuid, text, text) from public, anon, authenticated;
grant execute on function public.apply_audited_update(text, uuid, jsonb, uuid, text, text) to service_role;

-- Saves several settings at once, all of them or none, with one record per value
-- that really changes. entity_id stays null because the key is text.
create function public.apply_audited_settings(p_rows jsonb, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_before jsonb;
begin
  for r in select * from jsonb_to_recordset(p_rows) as x (key text, value jsonb) loop
    select s.value into v_before from public.system_settings s where s.key = r.key;

    insert into public.system_settings (key, value, updated_at)
    values (r.key, r.value, now())
    on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

    if v_before is distinct from r.value then
      insert into public.audit_log (actor_id, action, entity, before, after)
      values (
        p_actor,
        'settings.update',
        'system_settings',
        jsonb_build_object('key', r.key, 'value', v_before),
        jsonb_build_object('key', r.key, 'value', r.value)
      );
    end if;
  end loop;
end;
$$;

revoke all on function public.apply_audited_settings(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.apply_audited_settings(jsonb, uuid) to service_role;

-- The share value permission already runs from the tesorero's session, so the
-- record goes inside its own function.
CREATE OR REPLACE FUNCTION public.allow_share_value_change(p_profile_id uuid, p_allow boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_period_id uuid;
  v_before boolean;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;

  select id into v_period_id from public.periods where status = 'open';
  if v_period_id is null then
    raise exception 'period_not_open'
      using hint = 'El valor de la acción solo se elige mientras el periodo está abierto.';
  end if;

  if p_allow and public.has_share_receipts_in_period(p_profile_id, v_period_id) then
    raise exception 'share_value_locked_by_purchase'
      using hint = 'Ya hay un recibo con acciones en el periodo (RN-2.2).';
  end if;

  select share_value_change_allowed into v_before
    from public.period_memberships
   where profile_id = p_profile_id and period_id = v_period_id;

  update public.period_memberships
     set share_value_change_allowed = p_allow
   where profile_id = p_profile_id
     and period_id = v_period_id
     and share_value is not null;

  if not found then
    raise exception 'share_value_not_chosen'
      using hint = 'El accionista todavía no eligió el valor de su acción.';
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after, is_self_action)
  values (
    auth.uid(),
    case when p_allow then 'share_value.allow' else 'share_value.revoke' end,
    'period_memberships',
    p_profile_id,
    jsonb_build_object('share_value_change_allowed', v_before),
    jsonb_build_object('share_value_change_allowed', p_allow),
    p_profile_id = auth.uid()
  );

  return p_allow;
end;
$function$;
