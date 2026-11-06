-- S4 T3: RN-4.29. No loan ends with a negative balance or negative interest, on
-- any path. The rule itself lives in the domain (validarAbonoACapital); this is
-- the database defense (ADR-001).
--
-- Interest owed is computed, not stored, so deducted_interest_amount is the only
-- interest column a constraint can protect.

alter table public.loans
  add constraint loans_outstanding_balance_not_negative check (outstanding_balance >= 0),
  add constraint loans_deducted_interest_not_negative check (deducted_interest_amount >= 0);

-- The trigger used to clamp the balance at 0, which hid an overpayment. Now the
-- constraint rejects it and the approval rolls back with the receipt still pending.
-- The subtraction predates this migration and is a recorded exception to ADR-001
-- until the approval moves to a use case with a transactional RPC.
create or replace function public.apply_loan_payment_on_receipt_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if new.status <> 'approved' then
    return new;
  end if;
  if old.status = 'approved' then
    return new;  -- already approved: never apply twice
  end if;

  for r in
    select ri.loan_id, sum(ri.amount) as total
      from public.receipt_items ri
     where ri.receipt_id = new.id
       and ri.concept    = 'pago_capital'
       and ri.loan_id is not null
     group by ri.loan_id
  loop
    update public.loans
       set outstanding_balance = outstanding_balance - r.total,
           status = case
             when outstanding_balance - r.total = 0 then 'paid'::loan_status
             else status
           end,
           updated_at = now()
     where id = r.loan_id;
  end loop;

  return new;
end;
$$;
