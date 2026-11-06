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
| T3 | S6, S7 | inline | pending | |
| T4 | S8, S9 | inline | pending | |
| T5 | S10, S11 | inline | pending | |

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
