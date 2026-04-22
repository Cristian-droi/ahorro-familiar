-- =============================================================================
-- Endurece constraints que no se pudieron aplicar con ADD COLUMN IF NOT EXISTS
-- sobre tablas preexistentes.
-- =============================================================================

-- 1. profiles: columnas que deben ser NOT NULL.
--    Antes de aplicar, nos aseguramos de no romper datos históricos.
update public.profiles set first_name = ''          where first_name is null;
update public.profiles set last_name = ''           where last_name is null;
update public.profiles set identity_document = id::text where identity_document is null;

alter table public.profiles
  alter column first_name        set not null,
  alter column last_name         set not null,
  alter column identity_document set not null;

-- 2. membership_requests.status: estaba como text, lo convertimos al enum.
--    Cualquier valor fuera del enum se normaliza a 'pending'.
update public.membership_requests
  set status = 'pending'
  where status not in ('pending', 'approved', 'rejected');

-- El CHECK constraint legacy compara status con text; lo removemos antes
-- del cambio de tipo. El enum ya restringe los valores permitidos.
alter table public.membership_requests
  drop constraint if exists membership_requests_status_check;

alter table public.membership_requests
  alter column status drop default;

alter table public.membership_requests
  alter column status type public.request_status
  using status::public.request_status;

alter table public.membership_requests
  alter column status set default 'pending';
