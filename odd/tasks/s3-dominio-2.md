# S3 · Dominio II

Objective: pure domain functions (TDD) for loan voting, payment application and share value per period, and moving the legacy `src/lib` money logic into the domain, as planned in `docs/roadmap.md` (S3, 2–8 Nov 2026).
Branch: `feat/s3-dominio-2` · Delivery: ask-on-risk · Test runner: `npx vitest run`.

## Specs

Rules are quoted verbatim from `docs/reglas-negocio.md`; roadmap items are quoted verbatim from `docs/roadmap.md`. Rules for T2–T4 are quoted here when each task starts.

- **S1 (RN-4.6)** "Votan **todos los accionistas activos excepto el solicitante**. Sea `n` = número de votantes habilitados."
- **S2 (RN-4.7)** "Se aprueba con **⌊n/2⌋ + 1 votos A FAVOR**. Se cuentan votos a favor, no participación. Quien no vota acepta el resultado."
- **S3 (RN-4.8)** "**Rechazo automático:** se rechaza apenas `votos_en_contra > n − (⌊n/2⌋ + 1)`, es decir, cuando ya es imposible aprobar. Queda una **observación registrada**, por ejemplo: *"Rechazado por votación: 10 en contra de 19 votantes"*."
  Example: "hay 20 accionistas, así que n = 19 votantes. Se necesitan **10 votos a favor**. El rechazo es automático en cuanto hay **10 votos en contra**."
- **S4 (RN-4.9b)** "**El voto es secreto.** Nadie ve quién votó qué, tampoco el gerente ni el tesorero. Cada votante ve su propio voto. Todos ven el **progreso** en totales: Votos a favor y en contra. Cuántos ya votaron, sobre el total de votantes. **No** se muestra la lista de quiénes ya votaron."
  Example: "*"A favor 7 · En contra 3 · Votaron 10 de 19"*".
- **S5 (roadmap)** "Aplicación de pagos: intereses primero y abonos parciales (RN-4.24 y 4.25). El abono a capital no supera el saldo y el excedente va a otro préstamo (RN-4.29; RN-4.29b 🟡)." Rewritten by Cris on 2026-10-26 (L8–L11) as RN-4.29b (cart) and RN-4.29c (fixed amount) in `docs/reglas-negocio.md`, section 4.6b.
- **S6 (roadmap)** "Mover `src/lib/loans.ts`, `fines.ts` y `obligations.ts` al dominio y actualizar los callers."
- **S7 (roadmap)** "Periodos y valor de acción por periodo (RN-2.2)."
- **S8** Follow-ups from the S2 review (`odd/tasks/s2-dominio-1.md`, L23–L24): money parameters of `open_capitalization_window(_v2)` to `bigint`; the compras page handles the permission error after `anon` lost EXECUTE; a CHECK that `loan_shares_amount` is a multiple of `loan_shares_count`; `gen:types` uses `--local`; configuration values validated in `parametros`.

Scope note (S4): the domain only returns totals; it never receives or returns who voted. Hiding individual votes from other users (RLS on `loan_votes`) belongs to S4 · Seguridad.

## Tasks

| ID | Specs | Route | Status | Commit |
|---|---|---|---|---|
| T1 | S1, S2, S3, S4 | inline | done | `becfad4` · RED: module missing → GREEN 21/21; `validarVotante` RED 2 failing → GREEN 23/23 |
| T2 | S5 | inline | done (uncommitted) | RED: modules missing → GREEN 26/26; cart and fixed amount RED: modules missing → GREEN 23/23 |
| T3 | S7 | inline | pending | |
| T4 | S6 | inline | pending | |
| T5 | S8 | inline | pending | |

T4 runs after T1–T3 so the callers move to domain functions that already exist.

## Log

- **L1 (2026-10-26)** "Sí, creá la rama feat/s3-dominio-2 y el documento de la S3, y arrancá con la votación (RN-4.6 a 4.9b)."
- **L2 (2026-10-26)** Legacy voting lives in `src/app/api/prestamos/[id]/vote/route.ts` and `requiredVotes` in `src/lib/loans.ts:202`. It uses `count_active_shareholders` as `n` (section 11, difference n.º 8: verify it excludes the applicant), rejects with "No se alcanzó el quórum de aprobación" instead of the RN-4.8 observation, and counts votes already cast as participation. The route moves to the domain in T4.
- **L3 (2026-10-26)** T1 done: `src/modules/prestamos/domain/votacion.ts` with `votantesHabilitados`, `votosNecesarios`, `resultadoDeVotacion` and `progresoDeVotacion`. Rule examples covered: n = 19 needs 10 in favor and is rejected at 10 against, with the observation "Rechazado por votación: 10 en contra de 19 votantes"; progress "A favor 7 · En contra 3 · Votaron 10 de 19". Assumptions, not in the rules: n = 0 returns `sin_votantes` (no vote is possible), more votes than voters returns `mas_votos_que_votantes`, and the observation says "1 votante" in singular. Full suite 190/190 on rerun (the cold first run failed 1 test again, the known ESLint boundaries timeout), ESLint and `tsc` clean.
- **L4 (2026-10-26)** Cris: "1. no puede haber n=0 ya que es imposible que ni haya nadie para votar, Ya que no tiene sentido hacer todo este sistema unicamente para 1 usuario y el Admin 2. No pueden haber mas votos que votantes" "Si el solicitante no puede votar". Both guards stay as defensive errors (a caller bug, never a real case). Added `validarVotante` (`solicitante_no_vota`, "No puedes votar en tu propio préstamo."), RED 2 failing → GREEN 23/23; full suite 192/192, ESLint and `tsc` clean. Confirmed difference n.º 8: `count_active_shareholders` is `SELECT COUNT(*) FROM profiles WHERE role = 'accionista'`, so it includes the applicant (20 shareholders → needs 11 instead of 10). The vote route already blocks the applicant. Both are fixed in T4.
- **L5 (2026-10-26)** "Sí, commiteá T1 con el documento de la S3 y seguí con T2 (aplicación de pagos)." T1 committed as `becfad4`; GGA review passed.
- **L6 (2026-10-26)** S5 rules (section 4.6): RN-4.24 "el pago se aplica primero a los **intereses acumulados de ese préstamo** y, cuando quedan en cero, a **capital**." RN-4.25 "Ejemplo: debe 60.000 y paga 40.000; quedan **20.000 de intereses pendientes** y no se abona nada a capital." RN-4.28 "Un préstamo pasa a **pagado** cuando su saldo de capital y sus intereses llegan a cero." RN-4.29 "**El abono a capital no puede superar el saldo pendiente del préstamo.** El sistema rechaza el pago y muestra el saldo máximo. Si el accionista tiene más préstamos, el excedente se registra como **otro abono** al préstamo que él elija." Example: A 1.200.000, B 2.023.688, 1.224.389 for capital → A 1.200.000, B 24.389 (balance 1.999.299). RN-4.29b 🟡 "¿se rechaza todo el pago o se acepta solo hasta el saldo?"
- **L7 (2026-10-26)** T2 done, uncommitted: `src/modules/prestamos/domain/pagos.ts` (`aplicarPago`, `estaPagado`, `repartirAbonoACapital`) and `src/shared/domain/dinero.ts` (`formatearPesos`, built by hand so it never depends on locale data). Assumptions: a payment must be > 0 (`pago_invalido`); the excess goes to capital of the next loans in the order the shareholder lists them (the example lowers B's balance directly), skipping loans at zero. 🟡 RN-4.29b: an excess with no loan left is rejected as RN-4.29 states, in an isolated `describe` marked 🟡; written before asking, so Cris must confirm it. Full suite 218/218, ESLint and `tsc` clean.
- **L8 (2026-10-26)** Cris: "El exedente va primero a acciones, luego a multas pendientes, si no tiene nada de eso va a intereses del otro prestamo y ya por ultimo el sobrante va a capital del otro prestamo. Si ya pago todo , no tiene nada pendiente (acciones, mutlas prestamos etc,) puede enviar elsobrante a acciones de los proximos meses, sino ahi si ya rechaza el pago."
- **L9 (2026-10-26)** Cris: "se compran solo las acciones enteras, y rechaza el resto." "lo que me imgino de esto es como si fuera un carrito de compras, donde el usuario pueda seleccionar que desea pagar, acciones, o prestamos etc. y el sistema le va mostrando cuando es el total que tiene que enviar" "si decide pagar las acciones de algun mes atrasado el sistema automaticamente le cobrara la multa de ese mes correpondiente" "me gusta la idea de que tambien haya la opcion de que si el accionista queira enviar un monto fijo el sistema lo distribuya siguiendo el orden antes dicho intereses -> acciones pendientes -> multas -> capital". The two orders contradicted each other; Cris confirmed ("Si ese orden esta bien"): interest of all loans → overdue months oldest first, each with its fine → current month → capital in the chosen order → whole future months, rest rejected.
- **L10 (2026-10-26)** Cris: "Automaticamente agrega 1 accion que es lo minimo que deberia comprar tanto apra aciones atrasadas como para las futuras". Implemented as `reglas.minAccionesPorMes` (RN-3.1).
- **L11 (2026-10-26)** RN-4.29b (cart) and RN-4.29c (fixed amount, with an example) written in `docs/reglas-negocio.md` section 4.6b; RN-4.29b removed from the 🟡 list. New module `src/modules/pagos/domain`: `totalDelCarrito` (reuses `validarCantidadDeAcciones` and `aplicarPago`) and `distribuirMontoFijo`. `repartirAbonoACapital` removed: step 4 replaces it and its RN-4.29 example moved to `monto-fijo.test.ts`. Assumptions for Cris: an overdue or current month is paid whole (share + fine) or not at all, and a month the amount cannot cover stops the split and rejects the rest; the leftover is returned as `rechazado` inside an ok result; the caller computes each month fine (RN-3.4) and the available future months; the cart rejects repeated months or loans. RED (modules missing) → GREEN 23/23; full suite 233/233, ESLint and `tsc` clean.
- **L12 (2026-10-27)** Cris: "Sí, el mes se paga completo o nada. Commiteá T2 y seguí con T3." The assumption from L11 is confirmed.
