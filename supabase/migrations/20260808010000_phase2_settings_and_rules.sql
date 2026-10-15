-- =============================================================================
-- Migración Fase 2: Configuración de Parámetros Globales Financieros y Préstamos
-- =============================================================================

INSERT INTO public.system_settings (key, value)
VALUES
  ('four_per_thousand_rate', '0.004'::jsonb),
  ('default_loan_interest_rate', '0.02'::jsonb),
  ('max_active_loans_enabled', 'true'::jsonb),
  ('max_active_loans_per_user', '2'::jsonb)
ON CONFLICT (key) DO NOTHING;
