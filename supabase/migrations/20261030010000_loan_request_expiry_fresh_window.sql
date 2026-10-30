-- =============================================================================
-- Ventana de 15 días nueva para las solicitudes pendientes (RN-4.5b).
--
-- Contexto:
--   - 20261030000000 llenó submitted_at con created_at. Un préstamo puede
--     quedar en borrador y enviarse días después, así que created_at puede
--     ser más viejo que el envío real y la solicitud se anularía sin razón al
--     primer movimiento después del despliegue (hallazgo de la revisión).
--   - No hay forma de saber la fecha real de envío de las solicitudes que ya
--     existen, así que se les da una ventana completa desde este despliegue.
--
-- Qué hace: a las solicitudes todavía pendientes (revisión, votación o
-- desembolso) les pone submitted_at = now(). No toca borradores ni préstamos
-- ya desembolsados, pagados, rechazados o vencidos.
-- =============================================================================

update public.loans
   set submitted_at = now()
 where status in ('pending_review', 'pending_shareholder_vote', 'pending_disbursement');
