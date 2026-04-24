-- ============================================================
-- Actualizaciones al módulo de préstamos
-- ============================================================

-- 1. Secuencia para consecutivos de desembolso (CE-XXXXX)
CREATE SEQUENCE IF NOT EXISTS public.disbursement_number_seq
  START WITH 1 INCREMENT BY 1 MINVALUE 1 NO MAXVALUE CACHE 1;

-- 2. Nuevas columnas en loans
ALTER TABLE public.loans
  ADD COLUMN IF NOT EXISTS disbursement_proof_path TEXT,
  ADD COLUMN IF NOT EXISTS disbursement_number     TEXT UNIQUE;

-- 3. Trigger: asigna CE- al momento en que el préstamo pasa a 'active'
CREATE OR REPLACE FUNCTION public.assign_disbursement_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'active'
     AND OLD.status IS DISTINCT FROM 'active'
     AND NEW.disbursement_number IS NULL THEN
    NEW.disbursement_number :=
      'CE-' || lpad(nextval('public.disbursement_number_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS loans_assign_disbursement_number ON public.loans;
CREATE TRIGGER loans_assign_disbursement_number
  BEFORE UPDATE ON public.loans
  FOR EACH ROW EXECUTE FUNCTION public.assign_disbursement_number();

-- 4. Función: saldo en caja
--    Entradas: suma de todos los recibos aprobados (acciones, pagos, multas, etc.)
--    Salidas:  suma de los montos desembolsados en préstamos activos / pagados
CREATE OR REPLACE FUNCTION public.get_cash_balance()
RETURNS NUMERIC
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(
      (SELECT SUM(total_amount) FROM receipts WHERE status = 'approved'),
      0
    )
    - COALESCE(
      (SELECT SUM(disbursed_amount)
       FROM loans
       WHERE status IN ('active', 'paid')
         AND disbursed_amount IS NOT NULL),
      0
    )
$$;

GRANT EXECUTE ON FUNCTION public.get_cash_balance TO authenticated;

-- 5. Actualizar RLS de loans: un accionista también puede ver préstamos en los
--    que votó (para el historial de votaciones), independientemente del estado.
DROP POLICY IF EXISTS "loans_select_own_or_voting" ON public.loans;
CREATE POLICY "loans_select_own_or_voting" ON public.loans
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR status = 'pending_shareholder_vote'
    OR is_admin()
    OR id IN (
      SELECT loan_id FROM public.loan_votes WHERE voter_id = auth.uid()
    )
  );
