-- =============================================================================
-- Migración: Ajustes de Resumen, Porcentajes y Capitalización del Siguiente Año
-- =============================================================================

-- 1. Agregar columna next_year_capitalization a la tabla profiles
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS next_year_capitalization numeric(14, 2) DEFAULT 0;

-- 2. Insertar valores de configuración iniciales en system_settings
INSERT INTO public.system_settings (key, value)
VALUES 
  ('resumen_expenses_percentage', '0.10'::jsonb),
  ('resumen_next_year_shares_percentage', '0.30'::jsonb),
  ('next_year_capitalization_active', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;
