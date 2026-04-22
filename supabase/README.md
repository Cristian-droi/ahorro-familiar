# Supabase — Ahorro Familiar

## Migraciones

Las migraciones viven en `supabase/migrations/` numeradas secuencialmente
(`001_*.sql`, `002_*.sql`, …). Son SQL plano e idempotente.

### Aplicar manualmente (recomendado en esta etapa)

1. Abrir el proyecto en <https://app.supabase.com>.
2. `SQL Editor → New query`.
3. Pegar el contenido de cada archivo en orden y ejecutar.

> El archivo `001_schema_and_rls.sql` se puede re-ejecutar sin problema
> sobre una base existente: crea tipos/tablas solo si no existen y
> migra la columna legacy `is_admin` a `role`.

### Verificar que RLS quedó activo

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('profiles', 'membership_requests');
```

Ambas filas deben mostrar `rowsecurity = true`.

## Crear el primer admin

RLS bloquea inserts directos en `profiles`; hay que usar el service role
desde un script. Ver `scripts/seed-admin.mjs`.
