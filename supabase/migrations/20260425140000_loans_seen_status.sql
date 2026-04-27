-- =============================================================================
-- Generaliza el "seen" del borrower para cubrir todos los estados que
-- generan notificación al accionista (no solo rechazos):
--   - rejected_by_admin / rejected_by_shareholders
--   - pending_disbursement (listo para desembolso)
--   - active (recién desembolsado)
--
-- Cambios:
--   1. Renombramos `borrower_seen_rejection_at` → `borrower_seen_status_at`.
--   2. Trigger BEFORE UPDATE OF status: si el status cambió, reset seen=NULL.
--      Esto asegura que al pasar a un nuevo estado el badge vuelva a salir.
--   3. RPC `mark_my_loans_status_seen()` reemplaza al viejo
--      `mark_my_rejected_loans_seen()`. El viejo se elimina.
-- =============================================================================

-- 1. Renombrar columna (idempotente — solo si existe la vieja).
do $$ begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'loans'
       and column_name  = 'borrower_seen_rejection_at'
  ) then
    alter table public.loans
      rename column borrower_seen_rejection_at to borrower_seen_status_at;
  end if;

  -- Por si nunca existió (instalación fresca), creamos la nueva.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'loans'
       and column_name  = 'borrower_seen_status_at'
  ) then
    alter table public.loans add column borrower_seen_status_at timestamptz;
  end if;
end $$;

-- 2. Trigger: al cambiar el status, reseteamos el "seen" para que el badge
--    vuelva a aparecer en el siguiente render del accionista.
create or replace function public.reset_borrower_seen_on_status_change()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    new.borrower_seen_status_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reset_borrower_seen on public.loans;
create trigger trg_reset_borrower_seen
  before update of status on public.loans
  for each row execute function public.reset_borrower_seen_on_status_change();

-- 3. RPC nuevo: marca TODO lo notificable del user actual como visto.
--    Cubre rechazos, pending_disbursement y active.
create or replace function public.mark_my_loans_status_seen()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  if auth.uid() is null then return 0; end if;

  update public.loans
     set borrower_seen_status_at = now()
   where user_id = auth.uid()
     and status in (
       'rejected_by_admin',
       'rejected_by_shareholders',
       'pending_disbursement',
       'active'
     )
     and borrower_seen_status_at is null;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.mark_my_loans_status_seen() from public;
grant execute on function public.mark_my_loans_status_seen() to authenticated;

-- 4. Drop del RPC viejo (su lógica está cubierta por el nuevo).
drop function if exists public.mark_my_rejected_loans_seen();
