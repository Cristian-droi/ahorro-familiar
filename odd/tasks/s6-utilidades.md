# S6 · Utilidades

Objective: profits computed in `utilidades/domain` (RN-6) and served from the server to Mi capital, extracto and resumen; no money math in the browser; tesorero view per loan, as planned in `docs/roadmap.md` (S6, 23–29 Nov 2026), plan presented to Cris on 2026-11-10.
Branch: `feat/s6-utilidades` · Delivery: ask-on-risk, one commit per task; push and PR need Cris's explicit OK · Test runner: `npx vitest run`; SQL probes against local Supabase.

## Specs

- **S1 (roadmap)** "`utilidades/domain` (RN-6). Reemplaza los cálculos que hoy se hacen en el cliente."
- **S2 (RN-6.1)** "Las utilidades vienen de los **intereses efectivamente pagados** en el mes, no de los intereses que se deben."
- **S3 (Cris, 2026-11-10)** "Se reparten como utilidades de mayo en ese caso" — interest paid in June for May is May's profit, with May's participation.
- **S4 (RN-6.2)** "`participación(mes) = (valor acumulado de acciones + acciones por préstamo + capitalizaciones del accionista) / (total del grupo)`. Se calcula con lo acumulado hasta ese mes inclusive."
- **S5 (RN-6.3, RN-6.4)** "`utilidad(mes) = intereses pagados en el mes × participación(mes)`." "Las multas **no** entran en el reparto." Example: "en abril se pagaron 100.000 de intereses y Ana tiene el 30% de participación. A Ana le corresponden **30.000** de utilidad."
- **S6 (roadmap)** "Mi capital y extracto alimentados por casos de uso de lectura."
- **S7 (roadmap)** "Vista del tesorero: saldo, cuota pactada y cuota para cerrar el año."
- Assumptions (stated in the plan, not objected): the accumulation counts the current period only (January capitalization included), since the liquidation resets every year; rounding stays as today, to the peso per shareholder per month.

Cut order (roadmap): T4 first.

## Tasks

| ID | Specs | Route | Status | Commit / evidence |
|---|---|---|---|---|
| T1 | S1–S5 | inline | done | RED: module missing → GREEN 9/9 (`utilidades.test.ts`), `tsc` clean |
| T2 | S1, S6 | inline | done | Use case + API + 3 screens; differential on local data identical to the SQL (L4); suite 717/717, probes 150/150, `tsc` clean, lint 0 errors (24 warnings, as before) |
| T3 | S6 | inline | pending | |
| T4 | S7 | inline | pending | |

## Log

- **L1 (Cris, 2026-11-10)** "Dale corrije la documentació y continuemos entonces con la S6" — then, on the month question: "Se reparten como utilidades de mayo en ese caso".
- **L2** Mapping: profits only in SQL (`get_my_utilities_by_year`, `get_user_utilities_by_year`, `get_all_users_utilities_by_year`), grouped by `target_month`, `round()` per month, no year floor; callers Mi capital (`accionista/page.tsx`), extracto, admin/resumen. The admin "Utilidades" pill is all-time interest collected, computed in the browser with local time. `cuotaParaCerrarElAnio` exists with no UI. No application layer yet.
- **L3** T1: `src/modules/utilidades/domain/utilidades.ts` with `utilidadDelMes` (BigInt, half-up to the peso, like SQL `round`) and `utilidadesDelAnio` (12 months, accumulation from January of the period, interest by its own month). Rule clarification added to RN-6.1. Equivalence with the SQL to be checked in T2 with a differential against local data.
- **L4** T2: port `UtilidadesRepo` and use case `consultarUtilidades` (`application/`, tests written together with the code, not RED first), infra `utilidades-repo.ts` (service role, paginated by 1000), `GET /api/utilidades` (own; `userId` or `all=1` need gerente or tesorero: 403 otherwise; 400 on a bad year), client helper `src/lib/data/utilities-client.ts`. Mi capital (server) calls the use case; extracto and resumen use the API. Migration `20261110010000_drop_sql_utilities.sql` drops the three SQL functions (closes S4 F12); wrappers removed from `loans.ts` and `LoanRepository`. Differential on local data (Gere 3+3+3 shares in Mar/Jun/Sep, Ana 1 in Jun + Nov, interest 33.333 Sep and 640.000 Oct): SQL and API give the same participation, pool and distribution for every shareholder and month (Sep 30.000/3.333, Oct 576.000/64.000, Nov participation 0.2813/0.7188). Browser: Mi capital and extracto show Ana 67.333; resumen shows Gere 606.000 and Ana 67.333. Only difference by design: contributions of earlier years no longer count (period floor), not exercised by local data.
- **L5** GGA rejected the first T2 commit: unchecked cast of DB rows in the repo, and resumen/extracto swallowing a profits failure as 0. Fixed: Zod schema in `utilidades-repo.ts`; resumen and extracto now let the error reach their existing toast. Browser after the fix: API 200, resumen still Gere 606.000 / Ana 67.333.
