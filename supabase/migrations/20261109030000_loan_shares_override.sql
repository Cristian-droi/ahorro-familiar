-- S5 T3: loan shares exception (RN-4.12, docs/modelo-datos.md section 4.5).
-- When approving the request the tesorero may change the suggested count, with
-- a mandatory reason. The audit record keeps who, the suggested and the final
-- value; these columns keep the current state on the loan.

alter table public.loans
  add column loan_shares_suggested int check (loan_shares_suggested >= 0),
  add column loan_shares_override_reason text;

comment on column public.loans.loan_shares_suggested is
  'RN-4.12: count suggested by RN-4.10 when the tesorero changed it. Null: never changed.';
comment on column public.loans.loan_shares_override_reason is
  'RN-4.12: mandatory reason when loan_shares_count differs from loan_shares_suggested.';

-- The database refuses a changed count without its reason.
alter table public.loans
  add constraint loans_shares_override_has_reason check (
    loan_shares_suggested is null
    or loan_shares_count = loan_shares_suggested
    or nullif(btrim(loan_shares_override_reason), '') is not null
  );
