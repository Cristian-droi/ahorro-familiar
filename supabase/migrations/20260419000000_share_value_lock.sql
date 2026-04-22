-- =============================================================================
-- Bloqueo del valor de acción una vez seleccionado.
--
-- Regla de negocio:
--   - Un accionista puede elegir su `selected_share_value` una sola vez.
--   - Después queda bloqueado; solo el admin puede reabrirlo (flag
--     `share_value_change_allowed = true`).
--   - El admin no elige valor de acción para sí mismo (no compra acciones);
--     el trigger no le aplica.
--
-- Implementación: una columna boolean + un BEFORE UPDATE trigger en
-- `profiles`. El trigger:
--   - Solo actúa si cambia `selected_share_value`.
--   - Si el caller NO es admin y ya había valor previo y el flag está en
--     false → RAISE EXCEPTION (RLS ya filtra por id = auth.uid, así que el
--     caller siempre es el dueño cuando no es admin).
--   - Tras un cambio válido hecho por el usuario, auto-bloquea (flag=false).
--   - Cambios hechos por admin (rol 'admin' en profiles) no tocan el flag.
--
-- Idempotente.
-- =============================================================================

alter table public.profiles
  add column if not exists share_value_change_allowed boolean not null default true;

-- Backfill: cualquier usuario que YA tenía un valor seleccionado se queda
-- bloqueado. Los nuevos (NULL) quedan en true para que puedan elegir una
-- primera vez.
update public.profiles
   set share_value_change_allowed = false
 where selected_share_value is not null
   and share_value_change_allowed = true;

-- -----------------------------------------------------------------------------
-- Trigger function
-- -----------------------------------------------------------------------------
create or replace function public.enforce_share_value_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Solo nos interesa cuando el valor seleccionado cambia.
  if old.selected_share_value is distinct from new.selected_share_value then
    if not public.is_admin() then
      -- Usuario no-admin intentando cambiar su propio valor.
      if old.selected_share_value is not null
         and old.share_value_change_allowed = false then
        raise exception 'share_value_locked'
          using hint = 'El administrador debe autorizar el cambio del valor de acción.';
      end if;
      -- Cambio válido: auto-bloquear tras guardar.
      new.share_value_change_allowed := false;
    end if;
    -- Si el caller es admin, no tocamos el flag: el admin decide explícitamente.
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_share_value_lock on public.profiles;
create trigger trg_enforce_share_value_lock
  before update on public.profiles
  for each row execute function public.enforce_share_value_lock();
