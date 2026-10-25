@AGENTS.md

# Ahorro Familiar: instrucciones para la IA

App web que reemplaza el Google Sheet del banco familiar Ahorro Familiar: acciones, multas, préstamos con votación, utilidades y liquidación anual. Maneja **dinero real** de unos 31 accionistas. Un error de cálculo es un bug crítico.

## Lee esto antes de tocar código

| Documento | Para qué |
|---|---|
| [docs/reglas-negocio.md](docs/reglas-negocio.md) | **Fuente de verdad** de cada cálculo. Reglas con ID RN-x.y. |
| [docs/prd.md](docs/prd.md) | Qué se construye, roles y fases (MVP para enero de 2027) |
| [docs/arquitectura.md](docs/arquitectura.md) | Capas, carpetas, decisiones transversales y defensas |
| [docs/convenciones.md](docs/convenciones.md) | Cómo se escribe el código: nombres, tests, Git |
| [docs/adr/](docs/adr/) | Por qué se decidió cada cosa importante |

## Reglas no negociables

1. **El dominio calcula y la base protege** (ADR-001). Todo cálculo de dinero va en `src/modules/*/domain` como función pura. Nunca en SQL, en route handlers ni en componentes.
2. **TDD estricto en el dominio:** primero el test (con el ID RN y el ejemplo de `reglas-negocio.md`), después el código.
3. **Si una regla no está en `reglas-negocio.md`, no la inventes.** Preguntá. Las reglas marcadas 🟡 están pendientes de validar con el gerente: avisá antes de implementarlas.
4. **Si el código contradice `reglas-negocio.md`, el código está mal.** La sección 11 lista las diferencias conocidas.
5. **Escrituras:** solo mediante casos de uso. Si tocan varias tablas, con una RPC transaccional. Toda acción administrativa se audita.
6. **Fechas en `America/Bogota`** mediante `shared/domain/fechas.ts`. El dominio nunca llama a `new Date()`.
7. **Dinero en pesos enteros.** Se redondea solo donde la regla lo indica.
8. **Roles:** todo usuario es accionista, y `admin_role` puede ser `gerente` (lectura más segunda firma) o `tesorero` (escritura total). Lo propio del tesorero exige doble firma (RN-9.4).
9. **Migraciones versionadas.** Nunca editar una migración aplicada ni cambiar el esquema desde el panel.
10. **Next.js 16 tiene cambios incompatibles:** revisá `node_modules/next/dist/docs/` antes de usar una API de Next.

## Prohibido sin permiso explícito de Cris

- Hacer commit, push, merge o abrir PRs.
- Ejecutar migraciones contra un proyecto Supabase en la nube.
- Tocar datos reales o el Google Sheet, que es **solo lectura**.
- Agregar dependencias nuevas.

## Comandos

```bash
npm run dev        # servidor de desarrollo (puerto 3000)
npm run lint       # ESLint
npx tsc --noEmit   # chequeo de tipos
npm test           # tests (script pendiente de agregar)
npm run gen:types  # regenerar tipos de Supabase
```

## Estado actual (2026-10-19)

- El trabajo nuevo va en ramas `tipo/descripcion` con PR. La S1 (cimientos) está en el PR de `feat/s1-cimientos`. Después sigue la S2 (dominio I).
- **Supabase local:** `supabase start` aplica todas las migraciones desde cero. Los tipos se generan desde local (`supabase gen types typescript --local`).
- **Ya existen** `src/shared/domain` (`fechas.ts`, `result.ts`) y `src/modules/` (vacío, ver su README). La lógica legada sigue en `src/lib/` y se migra en la S3.
- **GGA** revisa cada commit con las reglas de `REVIEW.md`. En Windows necesita la variable `CLAUDE_CODE_GIT_BASH_PATH`.
