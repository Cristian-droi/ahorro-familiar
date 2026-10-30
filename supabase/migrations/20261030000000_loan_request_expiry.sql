-- =============================================================================
-- Vencimiento de la solicitud de préstamo (RN-4.5b).
--
-- Contexto:
--   - Cris definió la RN-4.5b el 2026-10-30: si pasan más de 15 días desde que
--     el accionista envía la solicitud (sale de borrador) y el préstamo no se
--     ha desembolsado, la solicitud queda anulada y hay que volver a hacerla.
--   - loans no guardaba cuándo se envió la solicitud.
--
-- Qué hace:
--   1. Agrega el estado 'expired' (anulada por vencimiento) a loan_status.
--      Esta migración no usa el valor nuevo: Postgres no permite usar un valor
--      de enum en la misma transacción en la que se agrega.
--   2. Agrega loans.submitted_at: momento en que la solicitud salió de
--      borrador. La API lo llena al enviar; queda null mientras sea borrador.
--   3. Backfill: para los préstamos que ya no están en borrador se usa
--      created_at, porque la fecha real de envío no quedó guardada. La app
--      crea y envía la solicitud en el mismo paso, así que es una buena
--      aproximación. Ojo: una solicitud pendiente creada hace más de 15 días
--      queda vencida en su próxima acción (votar, revisar o desembolsar).
-- =============================================================================

-- 1. Estado de solicitud vencida.
alter type public.loan_status add value if not exists 'expired';

-- 2. Momento de envío de la solicitud.
alter table public.loans
  add column submitted_at timestamptz null;

comment on column public.loans.submitted_at is
  'Momento en que la solicitud salió de borrador (RN-4.5b). Null en borrador.';

-- 3. Backfill de los préstamos ya enviados.
update public.loans
   set submitted_at = created_at
 where status <> 'draft'
   and submitted_at is null;
