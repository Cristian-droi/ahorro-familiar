-- =============================================================================
-- Migración Fase 1: Índices de Rendimiento, Parche de Seguridad y RPC Consolidado
-- =============================================================================

-- 1. Índices faltantes para acelerar búsquedas y JOINs
CREATE INDEX IF NOT EXISTS idx_loans_user_id ON public.loans(user_id);
CREATE INDEX IF NOT EXISTS idx_loans_status_user_id ON public.loans(status, user_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_loan_id ON public.receipt_items(loan_id);
CREATE INDEX IF NOT EXISTS idx_loan_payment_plan_items_loan_id ON public.loan_payment_plan_items(loan_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_user_concept ON public.receipt_items(concept, target_month);

-- 2. Parche de seguridad para la función count_active_shareholders (Search Path Hijacking)
ALTER FUNCTION public.count_active_shareholders() SET search_path = public;

-- 3. RPC Consolidado: get_all_users_utilities_by_year(p_year)
-- Devuelve la distribución de utilidades de TODOS los accionistas activos en el año
-- en una sola ejecución para evitar el problema de N+1 queries desde el frontend.

CREATE OR REPLACE FUNCTION public.get_all_users_utilities_by_year(
  p_year integer
)
RETURNS TABLE (
  user_id        uuid,
  month_number   integer,
  participation  numeric,
  utilities_pool numeric,
  distribution   numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m              integer;
  v_month_start  date;
  v_next_month   date;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden'
      USING HINT = 'Solo el administrador puede consultar utilidades consolidadas de los accionistas.';
  END IF;
  IF p_year IS NULL OR p_year < 2000 OR p_year > 2100 THEN
    RAISE EXCEPTION 'invalid_year';
  END IF;

  FOR m IN 1..12 LOOP
    v_month_start := make_date(p_year, m, 1);
    v_next_month  := (v_month_start + interval '1 month')::date;

    RETURN QUERY
    WITH active_profiles AS (
      SELECT id AS user_id FROM public.profiles WHERE role = 'accionista'
    ),
    user_acums AS (
      SELECT 
        r.user_id,
        COALESCE(SUM(ri.amount), 0) AS my_acum
      FROM public.receipts r
      JOIN public.receipt_items ri ON ri.receipt_id = r.id
      WHERE r.status = 'approved'
        AND ri.concept IN ('acciones', 'acciones_prestamo', 'capitalizacion')
        AND ri.target_month < v_next_month
      GROUP BY r.user_id
    ),
    total_acum AS (
      SELECT COALESCE(SUM(ri.amount), 0) AS total_acum
      FROM public.receipt_items ri
      JOIN public.receipts r ON r.id = ri.receipt_id
      WHERE r.status = 'approved'
        AND ri.concept IN ('acciones', 'acciones_prestamo', 'capitalizacion')
        AND ri.target_month < v_next_month
    ),
    pool AS (
      SELECT COALESCE(SUM(ri.amount), 0) AS pool_amount
      FROM public.receipt_items ri
      JOIN public.receipts r ON r.id = ri.receipt_id
      WHERE r.status = 'approved'
        AND ri.concept = 'pago_intereses'
        AND ri.target_month = v_month_start
    )
    SELECT 
      ap.user_id,
      m AS month_number,
      CASE 
        WHEN ta.total_acum > 0 THEN COALESCE(ua.my_acum, 0) / ta.total_acum
        ELSE 0
      END AS participation,
      p.pool_amount AS utilities_pool,
      CASE 
        WHEN ta.total_acum > 0 THEN ROUND((COALESCE(ua.my_acum, 0) / ta.total_acum) * p.pool_amount)
        ELSE 0
      END AS distribution
    FROM active_profiles ap
    LEFT JOIN user_acums ua ON ua.user_id = ap.user_id
    CROSS JOIN total_acum ta
    CROSS JOIN pool p;

  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.get_all_users_utilities_by_year(integer) FROM public;
GRANT EXECUTE ON FUNCTION public.get_all_users_utilities_by_year(integer)
  TO authenticated, service_role;
