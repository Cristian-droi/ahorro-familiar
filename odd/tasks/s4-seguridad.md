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
- **S12 (Cris, 2026-11-06)** "el gerente puede ver las pantallas pero en solo lectura"

Out of scope (approved): "tabla `approvals` (la doble firma es de la fase 1b), sacar `role`, y migrar `bank_accounts` y las capitalizaciones al servidor."

Open questions go to Cris when their task starts (RN text not quoted yet: RN-4.29 for T3, RN-9.x for T4).

## Tasks

| ID | Specs | Route | Status | Commit / evidence |
|---|---|---|---|---|
| T1 | S1, S2, S3 | inline | done | `c499161`. RED: `anon` ran `TRUNCATE loans`; vote summaries 3 failing → GREEN: `supabase/tests/s4_rls.sql` 29/29, suite 590/590, `tsc` clean, lint 0 errors. Browser check came with T2. Native review approved and acknowledged |
| T2 | S4, S5, S12 | inline | done | RED: `acceso-admin` test had no module; probes failed on missing `admin_role` → GREEN: probes 47/47, suite 605/605, `tsc` clean, lint 0 errors. Browser on local Supabase with the three roles (L11) |
| T3 | S6, S7 | inline | done | RED: probe "negative balance" got 1 row, domain and adapter tests had no code → GREEN: probes 56/56, suite 618/618, `tsc` clean, lint 0 errors. Routes checked on local Supabase (L16) |
| T4 | S8, S9 | inline | done | RED: `apply_audited_update` did not exist, `@/lib/audit` had no module, ownership test failed → GREEN: probes 85/85, suite 626/626, `tsc` clean, lint 0 errors. Routes on local Supabase (L20) |
| T5 | S10, S11 | inline | done | RED: the test expected an exception list that did not exist → GREEN: suite 651/651, `tsc` clean, lint 0 errors with 24 warnings, 18 of them the listed files. A new route, page or `src/lib` file that imports the admin client is now an error |

Follow-ups Cris asked to keep for later (L13). None is done:

| ID | Follow-up | Done when |
|---|---|---|
| F1 | The Supabase CLI rejects `supabase/config.toml` (`[inbucket]`), and `npx supabase` resolves to 3.0.0 because the project does not pin it | `supabase migration list` runs, and `db reset` applies every migration from zero |
| F2 | Cloud project: T1 and T2 migrations not applied, `TRUNCATE` hole unchecked | At S4 close, after the verifier and before the PR merge: read-only check done and pending migrations applied, each with Cris's OK |
| F3 | Capitalization button on the admin loan page writes `system_settings` from the browser and always fails | It uses the server, or it is removed |
| F4 | A tesorero with `role = 'admin'` sees "Mi cuenta", but buying, resubmitting and voting answer 403 | Decided when `role` is removed |
| F5 | No screen assigns `admin_role` | Assignment works from Accionistas (`docs/app-flow.md`) |
| F6 | `has_share_receipts_in_period` is callable by any logged-in user | `authenticated` loses EXECUTE and the callers still work |
| F7 | Not checked in the browser: Accionistas action buttons and the disbursement card as gerente | Both checked with local data |
| F8 | T1 review advisories: `getLoanWithDetails` failure path has no test; no positive probes for the writes `authenticated` keeps on `bank_accounts`, `capitalization_windows` and `profiles` | Test and probes added |
| F9 | `.env.local` points to the cloud, and the local dev script lives in a temporary folder | A documented local run in the repo |
| F10 | An interest payment above what is owed is not rejected: `adeudado` stops at 0 and the excess disappears. The limit needs RN-4.22b (current month's interest from day 16), which has no domain function yet | A rule and a limit, decided with Cris |
| F11 | T2 review advisories: a tesorero with `role = 'admin'` can get a "voto pendiente" notification they cannot clear (see F4); no probes for gerente reads on receipts, items, requests, memberships, plan items and windows, nor for the three report functions; no automated test for `requireAdmin` or the proxy | Probes and tests added, notification decided with F4 |
| F12 | ADR-001 debt: `get_all_users_utilities_by_year` and `get_user_utilities_by_year` still round money in SQL. T2 copied them unchanged except the guard | They move to the domain |
| F13 | ADR-001 exception: the approval trigger subtracts the capital payment in SQL | Approving a receipt is a use case with a transactional RPC |
| F14 | Not audited yet: disbursement (S5, as planned), membership requests, capitalization windows from the browser, and the automatic loan expiry. `receipt.approve` records the receipt's change, not the loan balance the trigger lowers. RN-9.4's notice to the gerente does not exist | Each one audited, or decided otherwise with Cris |
| F15 | No route-level test: the 409 on an approval race, and `resubmit` passing its own id and owner | Tests added |
| F16 | A stray review transaction, `review-5a135444eb60ec1a`, stays open for a candidate that no longer exists (L19). Abandoning it needs a maintainer authorization | Cris abandons it, or decides to leave it |
| F17 | T4 review advisories. `apply_audited_settings` reads the previous value without a lock, so two overlapping saves can lose a record. The guards of `apply_audited_update` (table, column, empty patch, missing row) have no probe that calls them. `is_self_action` fails on a null `user_id`. The share value record omits the period | New migration with the lock, probes added |

Route evidence: no Writer trigger; the tasks share migrations and depend on each other. Risk: item 2 (security), so an independent verifier runs at the feature's end.

## Log

- **L1 (2026-11-05, Cris):** "Sí, con ese recorte"
- **L2 (2026-11-05):** Local inventory: `anon` and `authenticated` hold every privilege, including `TRUNCATE`, on tables older than August (`loans`, `receipts`, `receipt_items`, `loan_votes`, `loan_payment_plan_items`, `profiles`, `system_settings`, `bank_accounts`, `capitalization_windows`, `email_change_requests`, `membership_requests`). `TRUNCATE` is not subject to RLS. Cloud not checked. `anon` can also execute 25 older public functions. T1 closes both.
- **L3 (2026-11-05):** `votes_admin_all` also breaks RN-4.9b and the admin loan page lists voters by name. Vote totals come from reading all rows, so T1 adds a totals RPC and removes the list.
- **L4 (2026-11-05):** Calling a denied function from a psql session after `SET ROLE` segfaults the local Postgres image. Through PostgREST with the anon key the same call answers 401 with no crash (`get_cash_balance`, `get_my_pending_loan_share_purchases`). Probes read function privileges from the catalog and call functions as `postgres`, because default privileges also deny `pg_temp` helpers to other roles. Cause not investigated further.
- **L5 (2026-11-05):** Visible change from T1: the capitalization button on the admin loan page (`enableCapitalization`) writes `system_settings` from the browser. It already wrote 0 rows with a false success toast; it now shows its error toast. Fixing it is not in T1.
- **L6 (2026-11-05):** The migration was applied only to local Supabase. The cloud project still needs Cris's OK and is unchecked.
- **L7 (2026-11-06, Cris):** "Has el commit de la T1, y el gerente puede ver las pantallas pero en solo lectura"
- **L8 (2026-11-06):** T1 native review (risk, reliability) approved with five advisories. One was a real T1 defect, fixed in T2: `get_loan_vote_totals` returned zero for a voter reading a loan after voting closed, because its filter was narrower than the `loans` read policy. New probe covers it. The claim that the T1 function loop widened `authenticated` is false: default privileges already give `authenticated` EXECUTE on every new function (checked by creating one in a rolled-back transaction).
- **L9 (2026-11-06):** Consequence of L8, not fixed here: `has_share_receipts_in_period` was meant to be internal but any logged-in user can call it, and it is SECURITY DEFINER. It reveals only whether a person has share receipts in a period. Follow-up for the S4 review.
- **L10 (2026-11-06):** T2 decisions. `admin_role` is the only source of administrative authorization; `role` still decides voters and utilities. A tesorero with `role = 'admin'` now reaches "Mi cuenta", but `/api/receipts`, resubmit and vote answer 403 until `role` goes, as they did before. No screen assigns `admin_role` yet: it is set by the tesorero through SQL or `profiles_update_admin_all`. Read paths for the gerente: seven read policies, a new one on `capitalization_windows`, one on payment proofs in storage, and three report functions.
- **L11 (2026-11-06):** Browser check, local Supabase only. Gerente: both menu sections, read-only notice on administrative routes and not in "Mi cuenta"; no action controls in Solicitudes, Libro de caja or loan detail; Ajustes admin section has 16 controls, all disabled; five administrative POST routes answer 403. Tesorero: both sections, no notice, action controls present, settings route answers 400 on an empty body, not 403. Shareholder: only "Mi cuenta", `/dashboard/admin` and `/dashboard/libro-caja` redirect, approve answers 403. Not exercised: Accionistas action buttons (no approved members locally) and the disbursement card (no loan in that state).
- **L12 (2026-11-06):** `supabase migration up` fails with the current CLI: "[inbucket] in supabase/config.toml is no longer supported. Use [local_smtp] instead." Migrations were applied with `psql` and recorded in `schema_migrations`. `db reset` from zero is still pending and needs this config fixed first. `.env.local` points to the cloud project, so `scripts/seed-admin.mjs` must not be used for local test users.
- **L13 (2026-11-06, Cris):** "Listo deja anotado todos esos pendientes para arreglarlos, despues, que se puede hacer para aareglar la base de datos supabase en la nube?"
- **L14 (2026-11-06, Cris):** "Listo dejemoslo para despues entonces. Entonces realiza el commit de la t2 y sigamos con la t3"
- **L15 (2026-11-06):** T2 committed as `fe1e4ee`; native review (risk, reliability) approved and acknowledged, three advisories in F11. T3 decisions: when creating or resubmitting, capital lines count other pending receipts, so several receipts cannot add up to more than the balance; approval compares only against the current balance. The trigger no longer clamps at 0, so a race fails the approval and the receipt stays pending. Interest owed is not stored, so the constraint covers `outstanding_balance` and `deducted_interest_amount`; interest overpayment is F10. The first version of the approval probe passed for the wrong reason (`receipts_reviewed_consistency`), so probes now name the violated constraint.
- **L16 (2026-11-06):** Routes on local Supabase, balance 1.000.000 with pending receipts of 1.000.001 and 400.000. `POST /api/receipts` for 1 peso answers 400, "Puedes abonar hasta $0". Approving 1.000.001 answers 422 and shows the maximum of $1.000.000; the receipt stays pending. Approving 400.000 answers 200 and leaves the balance at 600.000. Not exercised: resubmit route (adapter test only), the 409 race path (constraint proven by probe, route mapping not), and the shareholder's error toast in the cart.
- **L17 (2026-11-06, Cris):** "Listo haz el commit de la T3 y sigamos con la T4"
- **L18 (2026-11-06):** The commit hook (GGA) rejected T3 because the trigger subtracts money in SQL (ADR-001). That subtraction exists since April and T3 only removed the clamp, so it was recorded as a temporary exception in ADR-001 with follow-up F13 instead of moving approval to an RPC now. The route's 409 now matches the constraint name, as GGA also suggested. GGA also rejected money sums in `src/lib`, which moved to `sumarAbonosPorPrestamo`. T3 committed as `94c9c5c`.
- **L21 (2026-11-06, Cris):** "Listo realiza el commit  de la T4 y comencemos con la T5". T4 committed as `af85744`. T5: the exception is a list of exact files in `eslint.config.mjs` that keeps a warning, and tests fail if it grows past 18 or names a file that no longer imports the client. T4 native review (risk, resilience, reliability) approved with four advisories and acknowledged; they are in F17.
- **L19 (2026-11-06):** When the first T3 commit failed, a shell step ran `gentle-ai review start` with no tokens. The tool started a review without asking, because this session has no terminal: `review-5a135444eb60ec1a`, state reviewing, on the staged files of that moment. No reviewer ran. It was bound to a candidate that changed, so it does not affect later reviews. See F16. Multi-step review scripts now stop on the first failure.
- **L20 (2026-11-06):** T3 native review (risk, resilience, reliability) approved with four advisories and acknowledged. One was a real T3 defect, fixed here: a shareholder with another member's loan id could read that loan's number and available balance from the error message. `validateCapitalPayments` now takes `ownerId`, and the line reaches the trigger, which answers "El préstamo no pertenece a este accionista". T4 design: one transaction per action through `apply_audited_update` (loans, receipts), `apply_audited_settings`, and inside `allow_share_value_change`; before and after come from the database, limited to the changed columns. `audit_log.actor_id` is not null, and a profile with records cannot be deleted. Routes on local Supabase: rejecting a receipt, approving a loan plan, sending to vote, saving a setting and allowing a share value change each answer 200 and left one record with the right actor and reason; approving an overpaid receipt answers 422 with no record and the receipt pending. Not exercised through the route: a successful receipt approval (probe only) and the upfront shares toggle.
