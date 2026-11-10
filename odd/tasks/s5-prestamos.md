# S5 · Préstamos

Objective: atomic loan disbursement with `cash_outflows` (CE) and audit, RN-3.6 joining month, RN-4.12 loan shares override, and a verified "Comprar y pagar" flow, as planned in `docs/roadmap.md` (S5, 16–22 Nov 2026) with the scope Cris approved on 2026-11-09.
Branch: `feat/s5-prestamos` · Delivery: ask-on-risk, one commit per task (approved in the plan); push and PR need Cris's explicit OK · Test runner: `npx vitest run`; SQL probes against local Supabase.

## Specs

Roadmap items and rules are quoted verbatim from `docs/roadmap.md` and `docs/reglas-negocio.md`.

- **S1 (roadmap)** "RPC `desembolsar_prestamo` atómica, con `cash_outflows` (CE) y bloqueo de acciones por adelantado."
- **S2 (RN-4.17)** "El desembolso se registra como CE en el Libro de caja. **Debe ser atómico**: o se registra todo, o no se registra nada."
- **S3 (RN-4.14)** "**Por adelantado:** el préstamo **no se puede desembolsar** hasta que se registre y apruebe el pago de esas acciones."
- **S4 (approved plan, T1)** "Hace en una sola transacción el préstamo, el plan, el CE, el recibo de deducciones y la auditoría. El bloqueo por acciones pagadas por adelantado pasa a la base. El dominio sigue calculando. Corrige el bug del mes."
- **S5 (RN-3.6)** "Un accionista que ingresa a mitad del periodo compra acciones, y paga multas, **desde el mes de ingreso**, que es el mes en que se aprueba su ingreso. Los meses anteriores no le generan obligación ni multa."
  - Example: "el ingreso se aprueba el 5 de agosto, no compra nada y hoy es 20 de septiembre. Enero a julio: nada. Agosto: 41 días de mora, con tope: **15.000**. Septiembre: (20 − 10) × 500 = **5.000**."
- **S6 (RN-3.6, gerente 2026-11-09)** "si el ingreso se aprueba después del día 10, la multa de ese mes corre **desde la fecha de aprobación**, no desde el día 10. Si se aprueba hasta el día 10, se aplica RN-3.4 sin cambios."
  - Example: "se aprueba el 20 de agosto y el accionista no compra. El 30 de agosto debe 10 días × 500 = **5.000** de multa de agosto, y no 10.000."
- **S7 (approved plan, T2)** "guardar la fecha de aprobación al aceptar la solicitud. Las acciones se cobran desde ese mes y la multa del primer mes corre desde esa fecha. Los accionistas actuales quedan con enero. Primero el test."
- **S8 (RN-4.12)** "El administrador puede **modificar la cantidad** al aprobar la solicitud. Se registra en la auditoría con el valor sugerido, el valor final, un **motivo obligatorio** y quién hizo el cambio."
- **S9 (roadmap)** "Flujo \"Comprar y pagar\" con pagos a préstamos."
- **S10 (RN-4.25)** "Se permiten **pagos parciales de intereses**. Ejemplo: debe 60.000 y paga 40.000; quedan **20.000 de intereses pendientes** y no se abona nada a capital."
- **S11 (approved plan, T4)** "probarlo de punta a punta y corregir lo que falle."

Cut order if time runs out (approved): T3 first; T1 and T2 are never cut.

## Tasks

| ID | Specs | Route | Status | Commit / evidence |
|---|---|---|---|---|
| T0 | S6 | inline | done | RN-3.6 sub-rule and example added to `docs/reglas-negocio.md`, open question closed |
| T1 | S1–S4 | inline | done | RED: `disbursement.test.ts` failed on the missing module → GREEN 11/11; probes `s5_disbursement.sql` 21/21, `s4_rls.sql` 120/120, suite 668/668, `tsc` clean, lint 0 errors. Independent verifier: S1–S4 met, no blockers (L5) |
| T2 | S5–S7 | inline | done | RED: 5 domain tests + 2 adapter tests failed → GREEN; suite 681/681, probes `s5_joined_on.sql` 4/4, `s4_rls.sql` 120/120, `s5_disbursement.sql` 21/21, `tsc` clean, lint 0 errors (L7) |
| T3 | S8 | inline | pending | |
| T4 | S9–S11 | inline | pending | |

Route evidence: no writer trigger fires (tasks are sequential and share the loans area), so the parent writes inline. T1 names high-risk item 1 (persisted money writes, new table) and gets an independent verifier.

## Follow-ups

| ID | Finding | Done when |
|---|---|---|
| G1 | Already at baseline (verifier, L5): `get_cash_balance` overstates the cash box by the interest and capital deducted at disbursement; only the discounted loan shares are netted out. In a probe the box dropped 656.400 instead of the 776.400 transferred | The balance reads `cash_outflows` and drops the `loans.disbursed_amount` term, with a probe |
| G2 | A trigger rejection inside the disbursement (max shares per month, loan not active, target month) now returns a generic 500 instead of a readable 422. Before, the receipt failure was swallowed and the loan was disbursed anyway | Known trigger errors mapped to 422 with their message |
| G4 | T1 review advisories: no probe disburses with `pago_intereses`, `multa_acciones` or capital deductions, nor checks `last_interest_payment_date` on the referenced loan; no route-level test for the RPC payload (`applied_month`, `'cash'` proof, error mapping). R1-001/R3 "deductions without `deduct_obligations`" does not apply: the route passes `[]` when the flag is false (`disburse/route.ts:70-72`) | Probe and route test added |
| G5 | T2 advisories (verifier and review `review-4c2d65b3fe149a52`): (a) someone approved after day 10 owes that month's share the same day, so they show as overdue and loans are blocked until they buy; RN-3.6 does not say whether that month gets grace; (b) no test for the approval route writing `joined_on`, and a re-approval would overwrite it; (c) no test for approval exactly on day 10 or a late joining month reaching the cap (verifier ran them: 10.000 and 15.000, correct); (d) `calcularMulta` takes no joining date (no callers) | (a) decided with Cris or the gerente; (b)–(d) tests added |
| G3 | `last_interest_payment_date` on other loans is updated without an `audit_log` row (as before); voiding a CE has columns but no RPC | Audited, and a void RPC when voiding is needed |

## Log

- **L1 (Cris, 2026-11-09)** "1. La multa va desde la fecha de aprobación 2. Listo continuemos con la S5" — then, on the plan: "Si dale,continua entonces".
- **L2** Mapping (explorer, 2026-11-09): disbursement is `src/app/api/prestamos/[id]/disburse/route.ts`, ~8 separate writes, no audit, upfront block only in TS, deduction receipt `target_month` from server-local `getMonth()`; `cash_outflows` does not exist (design in `docs/modelo-datos.md` §4.4); no `loan_shares_suggested`/override columns and the review schema cannot change shares; the compras cart already pays full interest plus optional capital per loan; obligations start in January (`src/modules/pagos/domain/obligaciones.ts:58-65`) and no joining date is stored.
- **L3** T0 done (commit 5ff7be5): rule recorded for approval after day 10; approval on or before day 10 keeps RN-3.4. Next: T1.
- **L4** T1 in progress, uncommitted: `src/lib/disbursement.ts` + test (RED on missing module, then GREEN 11/11), migration `20261109010000_atomic_disbursement.sql` (`cash_outflows`, `desembolsar_prestamo` with advisory lock, upfront and cash checks, audited loan and receipt updates), route rewritten to call it, probes `supabase/tests/s5_disbursement.sql`. Blocked until Cris got Docker running.
- **L5** T1 verified. Probes 21/21 (one added for approved upfront shares), S4 probes 120/120, vitest 668/668, `tsc` clean, lint 0 errors (24 warnings, same as baseline). Independent verifier: S1–S4 met, no blockers; unrequested changes: plan errors now reported before the upfront error (same 422), receipt trigger failures abort the disbursement (G2), the orphan empty receipt no longer appears. Advisories became G1–G3.
- **L6** T1 commit eaa13f6 (GGA passed). Native review: assess `high` (item 1 escalated), consent granted by Cris, lenses risk/resilience/reliability, approved with 5 informational findings (G2, G4), acknowledged (`review-5df8e61af38f7428`). Reviewed boundary is now eaa13f6. Next: T2.
- **L7** T2 done: `profiles.joined_on` (migration `20261109020000`), set to the Bogotá day by the membership approval route; a shareholder cannot change it (self-update policy), the tesorero can. Domain: `detalleDeMulta`/`multaDelMes` take `ingreso` (no fine before the joining month; after day 10 the joining month counts from the approval day), `estadoDeObligaciones` takes `fechaDeIngreso` (months from the joining month). Callers pass it: `obligations.ts`, `receipts-build.ts` (server fines on receipts), admin overdue list, compras, extracto, historial. Null keeps January, so existing members do not change. Not covered: no route test for the approval route setting `joined_on`; members who joined earlier this year need their date loaded by hand if Cris wants it.
- **L8** T2 verified: independent verifier S5–S7 met, no blockers, null `joined_on` byte-identical to baseline across domain, adapter and obligations. Branch review `review-4c2d65b3fe149a52` (hook START, base 937644e, consent granted by Cris, lens reliability) approved with 5 warnings, acknowledged. R3-003 fixed in historial (a failed joining-date read no longer hides the share value). Remaining advisories in G4–G5. Next: T3.
