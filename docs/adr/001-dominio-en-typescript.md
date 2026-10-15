# ADR-001: Los cálculos de dinero viven en un dominio TypeScript puro

- **Estado:** Aceptado
- **Fecha:** 2026-10-14
- **Decisores:** Cris (tesorero y dueño del producto)

## Contexto

Las reglas de negocio de Ahorro Familiar (intereses, multas, acciones por préstamo, 4x1000, utilidades y liquidación) hoy están **repartidas en tres lugares**:

1. Funciones TypeScript: `src/lib/loans.ts`, `fines.ts` y `obligations.ts`.
2. Funciones y triggers SQL en Supabase: `get_loan_interest_owed`, `get_my_utilities_by_year`, entre otras.
3. Cálculos en el navegador: `dashboard/admin/resumen/page.tsx`.

**Consecuencia real:** existen **dos cálculos distintos de la deuda de intereses**, uno en el resumen y otro en el RPC, y pueden dar resultados diferentes. En una app que maneja la plata de una familia, eso es inaceptable.

Necesitamos **una única fuente de verdad** para los cálculos, fácil de probar contra los ejemplos de `reglas-negocio.md`.

## Decisión

**Todos los cálculos de dinero viven en funciones puras de TypeScript**, en la capa de dominio (`src/modules/*/domain`). No dependen de Supabase, de Next.js ni del reloj del sistema.

**Postgres no calcula reglas de negocio.** Su papel es:
- **Atomicidad:** funciones SQL transaccionales que reciben valores ya calculados y guardan todo o nada.
- **Seguridad:** RLS que impide escribir directamente desde el cliente.
- **Invariantes simples:** `CHECK`, triggers de inmutabilidad y bloqueo de la liquidación con intereses pendientes.

Resumen: **"el dominio calcula y la base protege"**.

## Alternativas consideradas

### B. Toda la lógica en SQL (funciones y triggers de Postgres)
- ➕ La atomicidad y la consistencia son naturales.
- ➕ Es imposible escribir datos sin pasar por la lógica.
- ➖ Los tests requieren una base de datos levantada: son lentos y difíciles de escribir por cada regla.
- ➖ PL/pgSQL es más difícil de leer y mantener, y la lógica queda "escondida".
- ➖ Acopla el negocio a Postgres y Supabase.

### C. Mantener el esquema mixto actual
- ➖ Es la causa del problema: duplicación e inconsistencias.

## Consecuencias

**Positivas**
- Cada regla RN-x.y tiene un test unitario rápido con su ejemplo numérico.
- Una sola implementación por regla, sin cálculos duplicados.
- El negocio queda independiente del framework: se puede cambiar Next.js o Supabase sin reescribir las reglas.
- Es legible para cualquier desarrollador de TypeScript.

**Negativas y riesgos**
- **Riesgo:** que algún código escriba en la base saltándose el dominio.
  - **Mitigación** (defensa en profundidad, ver `arquitectura.md`, sección 6): RLS que niega escrituras desde el cliente, ESLint que restringe los imports del cliente admin de Supabase, invariantes en la base, conciliación programada y auditoría.
- Hay que migrar las funciones SQL de cálculo existentes al dominio y dejar en SQL solo la persistencia transaccional y las validaciones.
- Las lecturas agregadas (utilidades de todo el grupo) pueden requerir cargar más datos al servidor. Se resuelve con consultas de lectura optimizadas que **traen datos crudos**, mientras el cálculo sigue en el dominio.
