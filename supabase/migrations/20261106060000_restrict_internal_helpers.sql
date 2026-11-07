-- S4 F28: close what the security advisors still report.
--
-- has_share_receipts_in_period let any signed-in user ask whether another
-- shareholder bought shares in a period. get_capitalization_window_state has no
-- caller in the app. Both are only used inside SECURITY DEFINER functions and by
-- enforce_period_share_value. Session roles cannot write that table: their writes go
-- through SECURITY DEFINER functions, so those flows keep access through the function
-- owner, and service_role keeps EXECUTE.
--
-- The six trigger functions below had no fixed search_path.

revoke all on function public.has_share_receipts_in_period(uuid, uuid) from public, anon, authenticated;
grant execute on function public.has_share_receipts_in_period(uuid, uuid) to service_role;

revoke all on function public.get_capitalization_window_state() from public, anon, authenticated;
grant execute on function public.get_capitalization_window_state() to service_role;

alter function public.set_updated_at() set search_path = public;
alter function public.recompute_receipt_total() set search_path = public;
alter function public.assign_disbursement_number() set search_path = public;
alter function public.reset_borrower_seen_on_status_change() set search_path = public;
alter function public.assign_receipt_number() set search_path = public;
alter function public.validate_receipt_item_target_month() set search_path = public;
