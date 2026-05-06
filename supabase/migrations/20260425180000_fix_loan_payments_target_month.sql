-- =============================================================================
-- Fix one-shot: pagos de préstamo cuyo target_month quedó ANTES del mes
-- del desembolso del préstamo correspondiente. Esto pasó cuando el RPC
-- get_user_active_loans_debt devolvía mes_actual − 1 sin clampar al
-- primer mes del plan (corregido en 20260425170000).
--
-- Solución: para cada receipt_item con concept ∈ {pago_capital,
-- pago_intereses} cuyo target_month sea anterior al date_trunc('month',
-- loans.disbursed_at), actualizar target_month al mes calendario del
-- desembolso. Así quedan dentro del rango del plan y se reflejan
-- correctamente en el libro de accionista, extracto y cálculo de
-- interés en mora.
-- =============================================================================

update public.receipt_items ri
   set target_month = date_trunc(
         'month',
         (l.disbursed_at at time zone 'America/Bogota')::date
       )::date
  from public.loans l
 where ri.loan_id = l.id
   and ri.concept in ('pago_capital', 'pago_intereses')
   and l.disbursed_at is not null
   and ri.target_month < date_trunc(
         'month',
         (l.disbursed_at at time zone 'America/Bogota')::date
       )::date;
