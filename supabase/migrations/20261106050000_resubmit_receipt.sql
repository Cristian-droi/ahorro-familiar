-- S4 F24: the resubmit route deleted the items, inserted the new ones and reopened
-- the receipt in three separate writes, filtered by id alone. A stale resubmit could
-- move an approved receipt back to pending, and the next approval subtracted the
-- payment again, because the trigger never reverses an approval.
--
-- Now it is one transaction, only from 'rejected' and only by the owner. A rejected
-- item leaves the old items and the status as they were.

create function public.resubmit_receipt(
  p_receipt_id uuid,
  p_actor uuid,
  p_items jsonb,
  p_patch jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt public.receipts;
begin
  select * into v_receipt from public.receipts where id = p_receipt_id for update;
  if not found then
    raise exception 'audit_entity_not_found';
  end if;
  if v_receipt.user_id is distinct from p_actor then
    raise exception 'resubmit_not_owner';
  end if;
  if v_receipt.status is distinct from 'rejected'::public.receipt_status then
    raise exception 'audit_status_conflict';
  end if;

  delete from public.receipt_items where receipt_id = p_receipt_id;

  insert into public.receipt_items (receipt_id, concept, target_month, share_count, unit_value, amount, auto_generated, loan_id)
  select p_receipt_id, i.concept, i.target_month, i.share_count, i.unit_value, i.amount, i.auto_generated, i.loan_id
    from jsonb_populate_recordset(null::public.receipt_items, p_items) i;

  perform public.apply_audited_update('receipts', p_receipt_id, p_patch, p_actor, 'receipt.resubmit', 'rejected');
end;
$$;

revoke all on function public.resubmit_receipt(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.resubmit_receipt(uuid, uuid, jsonb, jsonb) to service_role;
