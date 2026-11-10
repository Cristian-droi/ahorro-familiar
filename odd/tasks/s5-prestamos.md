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
| T1 | S1–S4 | inline | pending | |
| T2 | S5–S7 | inline | pending | |
| T3 | S8 | inline | pending | |
| T4 | S9–S11 | inline | pending | |

Route evidence: no writer trigger fires (tasks are sequential and share the loans area), so the parent writes inline. T1 names high-risk item 1 (persisted money writes, new table) and gets an independent verifier.

## Log

- **L1 (Cris, 2026-11-09)** "1. La multa va desde la fecha de aprobación 2. Listo continuemos con la S5" — then, on the plan: "Si dale,continua entonces".
- **L2** Mapping (explorer, 2026-11-09): disbursement is `src/app/api/prestamos/[id]/disburse/route.ts`, ~8 separate writes, no audit, upfront block only in TS, deduction receipt `target_month` from server-local `getMonth()`; `cash_outflows` does not exist (design in `docs/modelo-datos.md` §4.4); no `loan_shares_suggested`/override columns and the review schema cannot change shares; the compras cart already pays full interest plus optional capital per loan; obligations start in January (`src/modules/pagos/domain/obligaciones.ts:58-65`) and no joining date is stored.
- **L3** T0 done: rule recorded for approval after day 10; approval on or before day 10 keeps RN-3.4. Next: T1.
