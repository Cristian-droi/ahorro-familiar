-- Migration: Add loan_number sequence and unique ID column to loans table
-- Distinct from disbursement_number (CE-XXXXX)

CREATE SEQUENCE IF NOT EXISTS public.loan_number_seq START WITH 1 INCREMENT BY 1;

ALTER TABLE public.loans
  ADD COLUMN IF NOT EXISTS loan_number INTEGER UNIQUE;

-- Asignar consecutivo a los préstamos existentes en orden cronológico
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.loans WHERE loan_number IS NULL ORDER BY created_at ASC LOOP
    UPDATE public.loans SET loan_number = nextval('public.loan_number_seq') WHERE id = r.id;
  END LOOP;
END $$;

-- Trigger para asignar loan_number automáticamente en INSERT
CREATE OR REPLACE FUNCTION public.assign_loan_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.loan_number IS NULL THEN
    NEW.loan_number := nextval('public.loan_number_seq');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_loans_assign_loan_number ON public.loans;
CREATE TRIGGER trg_loans_assign_loan_number
  BEFORE INSERT ON public.loans
  FOR EACH ROW EXECUTE FUNCTION public.assign_loan_number();
