-- Habilita Realtime para la tabla loans.
--
-- Motivo: el header del dashboard suscribe a cambios en `loans` para
-- actualizar el badge de "préstamos pendientes" (revisión + desembolso) sin
-- que el admin tenga que recargar. El libro de caja también suscribe a
-- `loans` para refrescar el feed cuando se ejecuta un desembolso desde
-- otra pestaña/sesión.
--
-- Las tablas `receipts` y `receipt_items` ya están en la publicación
-- (ver 20260420000000_purchases_module.sql).
--
-- Idempotente: no falla si la tabla ya estaba en la publicación.
do $$ begin
  execute 'alter publication supabase_realtime add table public.loans';
exception when duplicate_object then null;
end $$;
