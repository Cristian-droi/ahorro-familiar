-- =========================================================================
-- Disbursement offset for cash balance
-- =========================================================================
--
-- Cuando un préstamo se desembolsa con `loan_shares_paid_upfront = false`,
-- el backend ahora crea automáticamente un recibo aprobado con un item
-- `acciones_prestamo` por el monto de las acciones que se descuentan al
-- accionista al momento del desembolso.
--
-- Ese recibo es **contable únicamente**: no representa entrada real de caja
-- (el accionista no transfirió ese dinero, simplemente se le descontó del
-- préstamo). Sin esta corrección la caja se inflaría por el monto de las
-- acciones por préstamo.
--
-- Por eso `get_cash_balance` debe restar la suma de esos items "offset" para
-- que la caja siga reflejando solo el efectivo realmente disponible.
--
-- En el caso `loan_shares_paid_upfront = true`, el recibo de acciones por
-- préstamo SÍ es cash real (el accionista transfirió antes del desembolso),
-- y NO debe restarse — por eso el filtro `loan_shares_paid_upfront = false`.
-- =========================================================================

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
    - COALESCE(
      (SELECT SUM(ri.amount)
       FROM receipt_items ri
       JOIN receipts r ON r.id = ri.receipt_id
       JOIN loans l    ON l.id = ri.loan_id
       WHERE ri.concept = 'acciones_prestamo'
         AND r.status = 'approved'
         AND l.loan_shares_paid_upfront = false
         AND l.disbursed_at IS NOT NULL),
      0
    )
$$;

GRANT EXECUTE ON FUNCTION public.get_cash_balance TO authenticated;
