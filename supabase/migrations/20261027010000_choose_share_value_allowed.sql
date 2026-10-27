-- =============================================================================
-- choose_share_value: proteger también los valores permitidos (RN-2.1).
--
-- Contexto:
--   - La RPC de 20261027000000 es security definer y cualquier usuario
--     autenticado la puede llamar directo por PostgREST, sin pasar por el caso
--     de uso que valida con elegirValorDeAccion. El trigger protege el bloqueo
--     (RN-2.2) pero no los valores permitidos.
--   - Igual que la ruta POST /api/acciones/valor, los permitidos salen de
--     system_settings.allowed_share_values. Sin ese ajuste no se acepta ningún
--     valor.
-- =============================================================================

create or replace function public.choose_share_value(p_share_value bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if not exists (
    select 1
      from public.system_settings s
     cross join lateral jsonb_array_elements_text(
       case when jsonb_typeof(s.value) = 'array' then s.value else '[]'::jsonb end
     ) as permitido(valor)
     where s.key = 'allowed_share_values'
       and permitido.valor ~ '^[0-9]+$'
       and permitido.valor::bigint = p_share_value
  ) then
    raise exception 'share_value_not_allowed'
      using hint = 'El valor de la acción debe ser uno de los permitidos (RN-2.1).';
  end if;

  select id into v_period_id from public.periods where status = 'open';
  if v_period_id is null then
    raise exception 'period_not_open'
      using hint = 'El valor de la acción solo se elige mientras el periodo está abierto.';
  end if;

  insert into public.period_memberships (profile_id, period_id, share_value, share_value_locked_at)
  values (auth.uid(), v_period_id, p_share_value, now())
  on conflict (profile_id, period_id) do update
    set share_value = excluded.share_value,
        share_value_locked_at = excluded.share_value_locked_at;

  return p_share_value;
end;
$$;

revoke all on function public.choose_share_value(bigint) from public;
grant execute on function public.choose_share_value(bigint) to authenticated;
