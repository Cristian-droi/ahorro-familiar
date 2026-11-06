-- S4 F18: the routes read the status and then write, so two reviews of one receipt
-- could both pass the check. Approved then rejected left the balance lowered, and
-- rejected then approved subtracted it again.
--
-- The check now also runs under the row lock, against the status the route read.
-- The expected status is required, so no caller can skip it. Null is refused.

drop function public.apply_audited_update(text, uuid, jsonb, uuid, text, text);

create function public.apply_audited_update(
  p_entity text,
  p_id uuid,
  p_patch jsonb,
  p_actor uuid,
  p_action text,
  p_expected_status text,
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

  if (v_row ->> 'status') is distinct from p_expected_status or p_expected_status is null then
    raise exception 'audit_status_conflict';
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

revoke all on function public.apply_audited_update(text, uuid, jsonb, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_audited_update(text, uuid, jsonb, uuid, text, text, text) to service_role;
