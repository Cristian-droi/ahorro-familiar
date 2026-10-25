# Convenciones: Ahorro Familiar

> Reglas para escribir código en este proyecto, sea una persona o una IA quien lo escriba. Complementa [arquitectura.md](./arquitectura.md).
>
> **Versión:** 0.1 · **Fecha:** 2026-10-14

---

## 1. Idioma y nombres

**Lenguaje ubicuo:** el negocio se nombra **en español**, con los mismos términos de [reglas-negocio.md](./reglas-negocio.md).

| Qué | Idioma | Ejemplo |
|---|---|---|
| Módulos, casos de uso, funciones y tipos de dominio | Español | `modules/prestamos`, `calcularMulta()`, `type Prestamo` |
| Términos técnicos genéricos | Inglés | `Result`, `Repository`, `handler`, `props` |
| Rutas de la UI | Español | `/dashboard/prestamos` |
| Tablas y columnas existentes en la base | Se mantienen (inglés) | `loans`, `receipts`, `outstanding_balance` |
| Tablas y columnas nuevas | Inglés, por consistencia con las existentes | `audit_log`, `approvals` |
| Commits, PRs y documentación | Español | `feat(prestamos): ...` |

> La base de datos se queda en inglés porque renombrar tablas en uso es costoso y riesgoso. El mapeo de inglés a español se hace en la capa `infra`.

**Formato de nombres**
- Archivos: `kebab-case.ts`. Componentes React: `PascalCase.tsx`.
- Funciones y variables: `camelCase`. Tipos: `PascalCase`. Constantes de dominio: `UPPER_SNAKE_CASE`.
- Columnas SQL: `snake_case`.
- Las funciones de dominio empiezan con un verbo: `calcular…`, `validar…`, `aplicar…`, `determinar…`.

## 2. Reglas de las capas (obligatorias)

1. **El dominio es puro.** No importa Supabase, Next.js, `fetch` ni `process.env`, y nunca llama a `new Date()`: la fecha llega por parámetro.
2. **Cálculo de dinero solo en el dominio.** Si escribís una suma, multiplicación o porcentaje sobre plata fuera de `modules/*/domain`, está mal ubicado.
3. **Escritura solo por casos de uso.** Los route handlers y las server actions **solo** validan la entrada con Zod y llaman a un caso de uso.
4. **Cliente admin de Supabase solo en `infra`.** ESLint lo hace cumplir.
5. **Escrituras de varias tablas = una RPC transaccional.** Nunca varias llamadas sueltas.
6. **Toda acción administrativa audita** en la misma transacción.
7. **Nada de lógica de negocio en componentes `"use client"`.** El cliente muestra lo que le entrega el servidor.

## 3. Dinero y fechas

- **Dinero:** enteros en pesos COP. Sin `float` para montos acumulados y sin `toFixed` para calcular.
- **Redondeo:** solo con `Math.round` y solo donde la regla lo indique. Se documenta con la referencia a la regla: `// RN-4.16`.
- **Porcentajes:** se guardan como decimal (`0.02`) y se muestran como porcentaje (`2%`).
- **Fechas:** siempre con las funciones de `shared/domain/fechas.ts`, que usan `America/Bogota`. Está prohibido `getFullYear()`, `getMonth()` o `getDate()` sobre fechas del servidor.

## 4. Errores

- El dominio devuelve `Result<T, ErrorDeDominio>` para los errores esperados (por ejemplo, "intereses pendientes", "sin caja suficiente"). No lanza excepciones para reglas de negocio.
- Las excepciones se reservan para fallos inesperados: red, base de datos o bugs.
- Los mensajes de error que ve el usuario van en **español claro, sin jerga**: "Primero debes pagar los intereses de este préstamo (20.000)".
- **Nunca** se traga un error con `console.error` y se sigue como si nada en una operación de dinero.

## 5. Testing (TDD estricto en el dominio)

- **Ciclo obligatorio en el dominio:** 🔴 test que falla → 🟢 código mínimo → 🔵 refactor.
- **Cada regla RN-x.y con ejemplo numérico tiene su test**, con el ID en el nombre:
  ```ts
  it('RN-4.10: 900.000 exige 2 acciones por préstamo (techo)', () => {
    expect(calcularAccionesPorPrestamo(900_000)).toBe(2)
  })
  ```
- Si se cambia una regla, **primero** se actualiza `reglas-negocio.md`, después el test y al final el código.
- Ubicación: `modules/<x>/domain/__tests__/*.test.ts`.
- Los casos de uso se prueban con repositorios en memoria. La integración (RPC, RLS) se prueba contra Supabase local.
- Un bug de dinero se corrige **primero con un test que lo reproduce**.

## 6. Base de datos y migraciones

- Todo cambio de esquema es una **migración versionada** en `supabase/migrations/`, con el formato `YYYYMMDDHHMMSS_descripcion.sql` (14 dígitos).
- **Nunca** se cambia el esquema a mano desde el panel de Supabase.
- Toda tabla nueva tiene **RLS activado** y políticas explícitas en la misma migración.
- Toda tabla nueva lleva sus **`grant` explícitos** en la misma migración: las tablas y secuencias nacen sin privilegios para `anon` ni `authenticated` (migración `20260809010000_revoke_default_privileges.sql`). Las funciones nuevas nacen sin `EXECUTE` para `anon`: si una RPC debe ser pública, se le da el `grant` a propósito.
- **Ojo con las funciones fuera de `public`:** esa misma migración revoca el `EXECUTE` de `PUBLIC` sobre las funciones futuras de **todos los schemas**, no solo de `public`. En `public` los defaults de Supabase siguen dando `EXECUTE` a `authenticated` y `service_role`, pero en cualquier otro schema la función nace sin `EXECUTE` para nadie salvo su dueño. Toda función nueva en otro schema necesita su `grant execute ... to <rol>` explícito en la misma migración.
- Las migraciones ya aplicadas **no se editan**. Se corrigen con una migración nueva.
- Cada migración se prueba primero en Supabase local.
- Después de migrar, se regeneran los tipos: `npm run gen:types`.

## 7. Git

### Ramas
- `master`: estable. Solo recibe merges por PR.
- Ramas de trabajo: `tipo/descripcion-corta`, por ejemplo `feat/doble-firma`, `fix/redondeo-acciones-prestamo` o `docs/convenciones`.
- Una rama = un cambio coherente. Ramas cortas, de días y no de semanas.

### Commits
- **Conventional Commits en español:** `tipo(alcance): descripción en imperativo`.
  - Tipos: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`.
  - Alcance: el módulo (`prestamos`, `acciones`, `caja`...).
  - Ejemplo: `fix(prestamos): redondear acciones por préstamo hacia arriba (RN-4.10)`.
- Cuando aplica, el commit cita la regla RN.
- **Sin atribución de IA** en commits ni PRs.
- Nunca se commitean secretos (`.env*` está en `.gitignore`).

### Pull requests
- Toda rama entra a `master` por PR, aunque el equipo sea de una persona: el PR es el registro de **por qué** se cambió algo.
- Checklist del PR: tests en verde, lint y typecheck sin errores, reglas RN citadas y docs actualizados si cambió una regla.

### Saldos de línea
- Se agrega un `.gitattributes` con `* text=auto eol=lf` para eliminar los *warnings* de LF/CRLF entre Windows y Git.

## 8. Calidad antes de commitear

| Comando | Qué valida |
|---|---|
| `npm run lint` | ESLint, incluidas las fronteras entre capas |
| `npx tsc --noEmit` | Tipos |
| `npm test` | Tests (script por agregar) |

> Más adelante se automatiza con CI en GitHub Actions para que un PR no pueda entrar con algo en rojo.

## 9. UI

- **Primero el celular:** la mayoría de los accionistas va a usar el celular.
- **Lenguaje simple:** "Te faltan 20.000 de multa", no "Saldo de sanciones pendiente".
- **Montos siempre formateados** con `format.ts`, como `$ 1.250.000`.
- Cada pantalla tiene estados de **carga, vacío y error** definidos.
- Antes de cualquier acción irreversible (pagar, desembolsar, anular, liquidar), se muestra una **confirmación con el resumen** de lo que va a pasar.

## 10. Seguridad

- Los secretos solo van en variables de entorno, nunca en el código ni en los scripts. Los scripts reciben los datos por argumentos o por `.env.local` (ver `scripts/seed-admin.mjs`).
- La autorización siempre se valida en el servidor. Ocultar un botón **no** es seguridad.
- Datos reales del Sheet: **solo lectura**. Desarrollo y tests usan datos ficticios.
