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
- **S5 (roadmap)** "Aplicación de pagos: intereses primero y abonos parciales (RN-4.24 y 4.25). El abono a capital no supera el saldo y el excedente va a otro préstamo (RN-4.29; RN-4.29b 🟡)."
- **S6 (roadmap)** "Mover `src/lib/loans.ts`, `fines.ts` y `obligations.ts` al dominio y actualizar los callers."
- **S7 (roadmap)** "Periodos y valor de acción por periodo (RN-2.2)."
- **S8** Follow-ups from the S2 review (`odd/tasks/s2-dominio-1.md`, L23–L24): money parameters of `open_capitalization_window(_v2)` to `bigint`; the compras page handles the permission error after `anon` lost EXECUTE; a CHECK that `loan_shares_amount` is a multiple of `loan_shares_count`; `gen:types` uses `--local`; configuration values validated in `parametros`.

Scope note (S4): the domain only returns totals; it never receives or returns who voted. Hiding individual votes from other users (RLS on `loan_votes`) belongs to S4 · Seguridad.

## Tasks

| ID | Specs | Route | Status | Commit |
|---|---|---|---|---|
| T1 | S1, S2, S3, S4 | inline | done (uncommitted) | RED: module missing → GREEN 21/21; `validarVotante` RED 2 failing → GREEN 23/23 |
| T2 | S5 | inline | pending | |
| T3 | S7 | inline | pending | |
| T4 | S6 | inline | pending | |
| T5 | S8 | inline | pending | |

T4 runs after T1–T3 so the callers move to domain functions that already exist.

## Log

- **L1 (2026-10-26)** "Sí, creá la rama feat/s3-dominio-2 y el documento de la S3, y arrancá con la votación (RN-4.6 a 4.9b)."
- **L2 (2026-10-26)** Legacy voting lives in `src/app/api/prestamos/[id]/vote/route.ts` and `requiredVotes` in `src/lib/loans.ts:202`. It uses `count_active_shareholders` as `n` (section 11, difference n.º 8: verify it excludes the applicant), rejects with "No se alcanzó el quórum de aprobación" instead of the RN-4.8 observation, and counts votes already cast as participation. The route moves to the domain in T4.
- **L3 (2026-10-26)** T1 done: `src/modules/prestamos/domain/votacion.ts` with `votantesHabilitados`, `votosNecesarios`, `resultadoDeVotacion` and `progresoDeVotacion`. Rule examples covered: n = 19 needs 10 in favor and is rejected at 10 against, with the observation "Rechazado por votación: 10 en contra de 19 votantes"; progress "A favor 7 · En contra 3 · Votaron 10 de 19". Assumptions, not in the rules: n = 0 returns `sin_votantes` (no vote is possible), more votes than voters returns `mas_votos_que_votantes`, and the observation says "1 votante" in singular. Full suite 190/190 on rerun (the cold first run failed 1 test again, the known ESLint boundaries timeout), ESLint and `tsc` clean.
- **L4 (2026-10-26)** Cris: "1. no puede haber n=0 ya que es imposible que ni haya nadie para votar, Ya que no tiene sentido hacer todo este sistema unicamente para 1 usuario y el Admin 2. No pueden haber mas votos que votantes" "Si el solicitante no puede votar". Both guards stay as defensive errors (a caller bug, never a real case). Added `validarVotante` (`solicitante_no_vota`, "No puedes votar en tu propio préstamo."), RED 2 failing → GREEN 23/23; full suite 192/192, ESLint and `tsc` clean. Confirmed difference n.º 8: `count_active_shareholders` is `SELECT COUNT(*) FROM profiles WHERE role = 'accionista'`, so it includes the applicant (20 shareholders → needs 11 instead of 10). The vote route already blocks the applicant. Both are fixed in T4.
