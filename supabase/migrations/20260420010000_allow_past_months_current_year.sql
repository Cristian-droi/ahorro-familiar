-- =============================================================================
-- Ajuste al trigger validate_receipt_item_target_month:
--
-- La lógica de multas permite que el accionista pague meses atrasados del año
-- en curso (p. ej. en abril paga enero con 15.000 de multa). El trigger
-- original rechazaba cualquier target_month < mes actual; lo ampliamos a
-- "cualquier mes del año en curso", manteniendo el bloqueo de años pasados
-- y años futuros.
--
-- Idempotente (replace).
-- =============================================================================

create or replace function public.validate_receipt_item_target_month()
returns trigger
language plpgsql
as $$
declare
  v_today        date := (now() at time zone 'America/Bogota')::date;
  v_year_start_m date := date_trunc('year', v_today)::date;
  v_year_end_m   date := (date_trunc('year', v_today) + interval '11 months')::date;
begin
  -- Reglas duras solo para concepto 'acciones'.
  if new.concept = 'acciones' then
    if new.target_month < v_year_start_m then
      raise exception 'target_month_previous_year'
        using hint = 'Solo puedes comprar acciones del año en curso.';
    end if;
    if new.target_month > v_year_end_m then
      raise exception 'target_month_next_year'
        using hint = 'Solo puedes comprar acciones hasta diciembre del año en curso.';
    end if;
  end if;
  return new;
end;
$$;
