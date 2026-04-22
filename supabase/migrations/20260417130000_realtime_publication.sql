-- Habilita Realtime para las tablas que el frontend escucha.
-- Idempotente: no falla si las tablas ya estaban en la publicación.
do $$ begin
  execute 'alter publication supabase_realtime add table public.membership_requests';
exception when duplicate_object then null;
end $$;

do $$ begin
  execute 'alter publication supabase_realtime add table public.profiles';
exception when duplicate_object then null;
end $$;
