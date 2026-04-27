-- Marcar préstamos rechazados como "vistos" por el accionista para que el
-- badge de notificaciones desaparezca una vez que el user los revisó.
--
-- - Columna: borrower_seen_rejection_at TIMESTAMPTZ NULL.
-- - RPC: mark_my_rejected_loans_seen() — SECURITY DEFINER, marca con
--   NOW() todos los rejected_by_admin / rejected_by_shareholders del
--   accionista actual (auth.uid()) que aún no estaban vistos. Devuelve
--   la cantidad de filas afectadas. Se llama desde la página de
--   préstamos del accionista al montar.
--
-- Los 'draft' NO se marcan: siguen contando hasta que el user los reenvía
-- a revisión (ahí el status cambia y dejan de sumar al badge naturalmente).

ALTER TABLE public.loans
  ADD COLUMN IF NOT EXISTS borrower_seen_rejection_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.mark_my_rejected_loans_seen()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.loans
  SET borrower_seen_rejection_at = NOW()
  WHERE user_id = auth.uid()
    AND status IN ('rejected_by_admin', 'rejected_by_shareholders')
    AND borrower_seen_rejection_at IS NULL;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_my_rejected_loans_seen() FROM public;
GRANT EXECUTE ON FUNCTION public.mark_my_rejected_loans_seen() TO authenticated;
