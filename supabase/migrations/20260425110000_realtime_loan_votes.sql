-- Habilita Realtime para la tabla loan_votes.
--
-- Motivo: el header del accionista necesita refrescar el contador de
-- "préstamos esperando tu voto" en cuanto el usuario vota desde otra
-- pestaña (o cuando se cierra una votación). Sin esto, el badge se
-- queda con el conteo viejo hasta que el usuario navega.
--
-- Idempotente: no falla si la tabla ya estaba en la publicación.
do $$ begin
  execute 'alter publication supabase_realtime add table public.loan_votes';
exception when duplicate_object then null;
end $$;
