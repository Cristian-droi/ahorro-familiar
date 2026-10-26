# S2 · Dominio I

Objective: pure domain functions (TDD) for shares, fines and loan calculations, as planned in `docs/roadmap.md` (S2, 26 Oct – 1 Nov 2026).
Branch: `feat/s2-dominio-1` · Delivery: ask-on-risk · Test runner: `npx vitest run`.

## Specs

Rules are quoted verbatim from `docs/reglas-negocio.md`. Every value marked ⚙️ is a parameter: "Todo valor marcado como ⚙️ es un parámetro que el administrador configura. No se escribe fijo en el código."

- **S1 (RN-3.1)** "Cada accionista compra entre **1 y 10 acciones por mes** ⚙️."
- **S2 (RN-3.4)** "Cálculo de la multa:
  - **Mes en curso:** días de gracia ⚙️ = 10. Desde el día 11 se cobran 500 por día ⚙️, con tope de 15.000 por mes ⚙️. `multa_mes = MIN(MAX(día − 10, 0) × 500, 15.000)`
  - **Meses completos sin comprar:** 15.000 por cada uno ⚙️."
  Example: "la última compra fue en julio y hoy es 20 de septiembre. Agosto completo sin comprar: **15.000**. Septiembre: (20 − 10) × 500 = **5.000**. **Multa total: 20.000.**"
- **S3 (RN-4.10)** "`acciones_por_préstamo = TECHO(monto / 500.000)` ⚙️ (500.000 es el paso), **sin tope**."
- **S4 (RN-4.16)** "**4x1000:** se calcula sobre el **neto que realmente sale de la caja**, es decir, después de las deducciones (acciones por préstamo, multas, intereses y capital descontados)."
- **S5 (RN-4.18, RN-4.19)** "Tasa: **2% mensual** ⚙️ sobre el **saldo pendiente real**, nunca sobre el plan pactado." "**Interés simple:** los intereses atrasados **no** generan intereses."
- **S6 (RN-4.20)** "**Primer mes:** si el desembolso es **después del día 15** ⚙️, se cobra **media tasa (1%)**."
- **S7 (RN-4.15)** "**Mes aplicado:** si el desembolso es **después del día 25** ⚙️, el préstamo cuenta como **del mes siguiente**."
- **S8 (RN-4.3)** "Por defecto, hasta **diciembre del periodo actual**. Un préstamo de enero tiene 12 meses de plazo y uno de octubre, 3." "El administrador puede habilitar ⚙️ plazos hasta **diciembre del periodo siguiente**."
- **S9** Installment to close the year ("Cuota para cerrar el año", roadmap S2): "`saldo pendiente ÷ meses restantes hasta diciembre, incluido el actual`", rounded up (RN-4.30, L11).
- **S10** Migration: money columns to `bigint` ("Migración: dinero a `bigint`", roadmap S2). Local Supabase only.

Assumption (S2): the caller passes the first month without a purchase (`primerMesPendiente`), because purchases can target future months; the domain does not look up purchases.

## Tasks

| ID | Specs | Route | Status | Commit |
|---|---|---|---|---|
| T1 | S1, S2 | inline | done | `71a3fef` · RED: modules missing, `mesesEntre` 4 failing → GREEN 49/49 |
| T2 | S3 | inline | done | `977265c` · RED: module missing → GREEN 10/10 |
| T3 | S4 | inline | done | `e5a78dd` · RED: module missing → GREEN 12/12 |
| T5 | S7, S8, S9 | inline | done | `698b4dc` · RED: `sumarMeses` 3 and `diciembreDelAnio` 3 failing, module missing → GREEN; cuota de cierre RED module missing → GREEN 8/8 |
| T4 | S5, S6 | inline | done, awaiting commit OK | RED: module missing → GREEN 18/18 |
| T6 | S10 | inline + independent verifier (Risk item 1) | pending | |

T5 runs before T4 because the half rate depends on the applied month.

## Log

- **L1 (2026-10-25)** "Listo entonces continuemos ocn el proyecto"
- **L2 (2026-10-25)** "Sí, creá la rama feat/s2-dominio-1 y el documento de la S2, y arrancá con T1 (multas RN-3)."
- **L3** Plan accepted: T6 last, in its own commit; candidate to move to S3 if the week runs short. Legacy `src/lib` is migrated in S3, not now.
- **L4 (2026-10-25)** T1 done: `src/modules/acciones/domain/{compra,multas}.ts` and `mesesEntre` in `shared/domain/fechas.ts`. Full suite 101/101, ESLint and `tsc` clean. The first cold run had one failing test (41 s total, likely the ESLint boundaries test timing out on a cold start); two reruns passed. Commits need Cris's explicit OK (app `CLAUDE.md`).
- **L5 (2026-10-25)** "Sí, commiteá T1 con el documento de la S2 y seguí con T2." T1 committed as `71a3fef`; GGA review passed.
- **L6 (2026-10-25)** T2 done: `src/modules/prestamos/domain/acciones-por-prestamo.ts`. It also returns the shares' value (RN-4.14, example 900.000 at 50.000 → 100.000). The RN-4.11 exception ("Deuda año anterior" needs no shares) is left to the caller. Full suite 111/111, ESLint and `tsc` clean.
- **L7 (2026-10-25)** "Sí, commiteá T2 y seguí con T3 (4x1000)." T2 committed as `977265c`. GGA advisory (not blocking): `paso` and `valorAccion` are not validated (`paso` = 0 gives Infinity). Pending decision: validate configuration values in the domain or in the `parametros` module.
- **L8 (2026-10-25)** T3 done: `src/modules/prestamos/domain/desembolso.ts`, `calcularDesembolso({ monto, deducciones, tasaPorMil })`. The rate is an integer per thousand (4 = 0,004) to avoid binary fractions. Assumption, not in the rules: deductions larger than the amount are rejected (`deducciones_mayores_al_monto`). Full suite 123/123, ESLint and `tsc` clean.
- **L9 (2026-10-25)** "Sí, commiteá T3 y seguí con T5 (mes aplicado, plazo y cuota de cierre)." T3 committed as `e5a78dd`.
- **L10 (2026-10-25)** S7 and S8 done: `src/modules/prestamos/domain/calendario.ts` (`mesAplicado`, `plazoDelPrestamo`), plus `sumarMeses` and `diciembreDelAnio` in `shared/domain/fechas.ts`. Full suite 140/140, ESLint and `tsc` clean. S9 rule (section 4.7): "`saldo pendiente ÷ meses restantes hasta diciembre, incluido el actual`", example 900.000 in October → 300.000. Open question: the rules do not say how to round a non-exact division (e.g. 1.000.000 ÷ 3). Asked Cris.
- **L11 (2026-10-25)** "Redondeá la cuota para cerrar el año hacia arriba (Math.ceil), agregá la regla a reglas-negocio.md y terminá T5." Added RN-4.30 to `docs/reglas-negocio.md` (example 1.000.000 in October → 333.334).
- **L12 (2026-10-25)** T5 done: `src/modules/prestamos/domain/cuota-de-cierre.ts`, `cuotaParaCerrarElAnio({ saldo, mesActual, mesFinal })`. Assumptions: an extended loan spreads its balance until the last month of its term (`mesFinal` from `plazoDelPrestamo`), and a month after the term returns `fuera_del_plazo`. Full suite 148/148, ESLint and `tsc` clean.
- **L13 (2026-10-25)** T5 committed as `698b4dc`. Native review (RDD) of commits `71a3fef..698b4dc`: Cris granted consent, reliability lens, **approved** and acknowledged (lineage `review-c3e8c93e21c61efa`, authority burned). Non-blocking findings for later: (1) configuration values `paso`, `valorAccion`, `tasaPorMil` and min/max shares are not validated; (2) `cuotaParaCerrarElAnio` does not reject a month before the applied month (e.g. disbursed 26 Oct, queried in Oct → divides by 3 instead of 2); (3) the multas test "charges only the current month" uses day 8, inside the grace period, so it cannot detect a missing charge.
- **L14 (2026-10-25)** T4 waiting on Cris: RN-4.21 is 🟡; proposal is to implement it as written with an isolated test marked 🟡.
- **L15 (2026-10-26)** "Sí, implementá la RN-4.21 como está escrita, con su test aislado y marcado 🟡, y terminá T4."
- **L16 (2026-10-26)** T4 done: `src/modules/prestamos/domain/intereses.ts`, `interesDelMes` and `interesesDelPeriodo`. The rate is an integer in basis points (200 = 2%). RN-4.21 🟡 lives in its own `describe` block and in `tasaDelMes`. Full suite 166/166 on the warm rerun, ESLint and `tsc` clean. The cold first run failed one test again (44 s total) and passed on rerun; it could not be reproduced warm. Suspected cause: the ESLint boundaries test timing out on a cold start (pre-existing, not caused by S2).
