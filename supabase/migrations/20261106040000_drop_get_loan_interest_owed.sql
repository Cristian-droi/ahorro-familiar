-- S4 F19: any shareholder could read the interest owed on any loan through this
-- function, which is SECURITY DEFINER and has no owner check. The app stopped using
-- it in S3 (getLoanInterestOwed in the domain), and docs/modelo-datos.md plans its
-- removal (section 6).

drop function public.get_loan_interest_owed(uuid);
