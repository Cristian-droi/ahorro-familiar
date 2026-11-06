# S4 · Seguridad

Objective: money writes only from the server, `admin_role`, immutable `audit_log`, and enforcement of RN-4.29, as planned in `docs/roadmap.md` (S4, 9–15 Nov 2026), with the scope Cris approved on 2026-11-05.
Branch: `feat/s4-seguridad` · Delivery: ask-on-risk · Test runner: `npx vitest run`; RLS probes against local Supabase. Commits need Cris's explicit OK (app `CLAUDE.md`).

## Specs

Roadmap items and rules are quoted verbatim.

- **S1 (roadmap)** "RLS: escrituras de dinero solo desde el servidor. Corregir `loans_update_own_draft`."
- **S2 (approved plan, T1)** "Quitar las escrituras directas en `loans`, planes de pago y votos, quitar `votes_select_all` y revocar los permisos amplios de las tablas viejas."
- **S3 (RN-4.9b)** "**El voto es secreto.** Nadie ve quién votó qué, tampoco el gerente ni el tesorero. Cada votante ve su propio voto. Todos ven el **progreso** en totales: Votos a favor y en contra. Cuántos ya votaron, sobre el total de votantes. **No** se muestra la lista de quiénes ya votaron."
- **S4 (roadmap)** "`profiles.admin_role` (`gerente` o `tesorero`) y ajuste de `src/proxy.ts` y del menú en dos secciones."
- **S5 (approved plan, T2)** "Migrar admin a tesorero y mantener `is_admin()` solo para el tesorero. **`role` se queda por ahora**, porque quitarlo cambia quién cuenta para votos y utilidades."
- **S6 (roadmap)** "Restricción en la base: saldo e intereses de préstamos nunca negativos (RN-4.29)."
- **S7 (approved plan, T3)** "Agregar el `CHECK` de saldo y rechazar el sobrepago al crear y al aprobar el recibo."
- **S8 (roadmap)** "`audit_log` inmutable, escrita por los casos de uso."
- **S9 (approved plan, T4)** "Crear la tabla inmutable y auditar préstamos, recibos y ajustes. El desembolso atómico y su auditoría quedan para la S5, como ya dice el roadmap."
- **S10 (roadmap)** "Subir a **error** la regla de ESLint del cliente admin fuera de `infra` (hoy es warning por el código legado)."
- **S11 (approved plan, T5)** "Subir la regla a `error`, con excepción temporal para las 18 rutas viejas, que salen de la lista a medida que se migran."

Out of scope (approved): "tabla `approvals` (la doble firma es de la fase 1b), sacar `role`, y migrar `bank_accounts` y las capitalizaciones al servidor."

Open questions go to Cris when their task starts (RN text not quoted yet: RN-4.29 for T3, RN-9.x for T4).

## Tasks

| ID | Specs | Route | Status | Commit / evidence |
|---|---|---|---|---|
| T1 | S1, S2, S3 | inline | done | RED: `anon` ran `TRUNCATE loans`; vote summaries 3 failing → GREEN: `supabase/tests/s4_rls.sql` 29/29, suite 590/590, `tsc` clean, lint 0 errors. No browser check yet (no local users) |
| T2 | S4, S5 | inline | pending | |
| T3 | S6, S7 | inline | pending | |
| T4 | S8, S9 | inline | pending | |
| T5 | S10, S11 | inline | pending | |

Route evidence: no Writer trigger; the tasks share migrations and depend on each other. Risk: item 2 (security), so an independent verifier runs at the feature's end.

## Log

- **L1 (2026-11-05, Cris):** "Sí, con ese recorte"
- **L2 (2026-11-05):** Local inventory: `anon` and `authenticated` hold every privilege, including `TRUNCATE`, on tables older than August (`loans`, `receipts`, `receipt_items`, `loan_votes`, `loan_payment_plan_items`, `profiles`, `system_settings`, `bank_accounts`, `capitalization_windows`, `email_change_requests`, `membership_requests`). `TRUNCATE` is not subject to RLS. Cloud not checked. `anon` can also execute 25 older public functions. T1 closes both.
- **L3 (2026-11-05):** `votes_admin_all` also breaks RN-4.9b and the admin loan page lists voters by name. Vote totals come from reading all rows, so T1 adds a totals RPC and removes the list.
- **L4 (2026-11-05):** Calling a denied function from a psql session after `SET ROLE` segfaults the local Postgres image. Through PostgREST with the anon key the same call answers 401 with no crash (`get_cash_balance`, `get_my_pending_loan_share_purchases`). Probes read function privileges from the catalog and call functions as `postgres`, because default privileges also deny `pg_temp` helpers to other roles. Cause not investigated further.
- **L5 (2026-11-05):** Visible change from T1: the capitalization button on the admin loan page (`enableCapitalization`) writes `system_settings` from the browser. It already wrote 0 rows with a false success toast; it now shows its error toast. Fixing it is not in T1.
- **L6 (2026-11-05):** The migration was applied only to local Supabase. The cloud project still needs Cris's OK and is unchecked.
