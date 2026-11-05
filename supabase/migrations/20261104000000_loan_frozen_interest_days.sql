-- =============================================================================
-- Días de cada préstamo, guardados al desembolsarlo (RN-4.21b).
--
-- Contexto:
--   - El día límite de media tasa (RN-4.20) y el día de corte (RN-4.21) son
--     ajustes (system_settings: loan_full_rate_day_limit y loan_cutoff_day).
--     Hasta ahora los intereses de todos los préstamos se calculaban con los
--     ajustes vigentes, así que cambiar un ajuste cambiaba los intereses de los
--     préstamos ya desembolsados (por ejemplo, aparecían 10.000 pendientes que
--     nunca se debieron).
--   - RN-4.21b: esos dos días quedan guardados en el préstamo al desembolsarlo,
--     con los valores que regían ese día, y el préstamo siempre se calcula con
--     sus propios días.
--
-- Qué hace:
--   - Agrega a loans las columnas full_rate_day_limit y cutoff_day (enteros,
--     opcionales mientras el préstamo no se desembolse), con los mismos rangos
--     que los ajustes: límite de 1 a 27, corte de 2 a 28 y límite menor que el
--     corte.
--   - A los préstamos ya desembolsados (disbursed_at no nulo) les pone 15 y 25:
--     son los únicos valores que se usaron hasta ahora.
--   - Un préstamo desembolsado debe tener los dos días (el desembolso los
--     guarda en la misma actualización que pone disbursed_at).
-- =============================================================================

alter table public.loans
  add column full_rate_day_limit integer,
  add column cutoff_day integer;

update public.loans
   set full_rate_day_limit = 15,
       cutoff_day = 25
 where disbursed_at is not null;

alter table public.loans
  add constraint loans_full_rate_day_limit_range
    check (full_rate_day_limit is null or full_rate_day_limit between 1 and 27),
  add constraint loans_cutoff_day_range
    check (cutoff_day is null or cutoff_day between 2 and 28),
  add constraint loans_full_rate_day_limit_before_cutoff
    check (full_rate_day_limit is null or cutoff_day is null or full_rate_day_limit < cutoff_day),
  add constraint loans_disbursed_has_interest_days
    check (disbursed_at is null or (full_rate_day_limit is not null and cutoff_day is not null));

comment on column public.loans.full_rate_day_limit is
  'RN-4.20/RN-4.21b: día límite de media tasa que regía al desembolsar el préstamo.';
comment on column public.loans.cutoff_day is
  'RN-4.21/RN-4.21b: día de corte que regía al desembolsar el préstamo.';
