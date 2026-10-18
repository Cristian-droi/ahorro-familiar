# Code Review Rules: Ahorro Familiar

This app handles real money for about 31 shareholders. A calculation error is a critical bug.
Source of truth: `docs/convenciones.md`, `docs/arquitectura.md` and `docs/reglas-negocio.md`.

## Scope

- Judge ONLY the lines added or changed in this commit.
- Legacy code in `src/lib/` and `src/app/` predates these rules and is being migrated (roadmap S3). Do NOT reject a commit for untouched legacy lines.
- New code in legacy files must still follow the rules below.

## Money and domain

REJECT if:
- New money arithmetic (sums, multiplications, percentages, interest, fines) is written outside `src/modules/*/domain`.
- Code in `src/modules/*/domain` imports Supabase, Next.js, `fetch`, `process.env` or any I/O.
- Code in `src/modules/*/domain` calls `new Date()` or `Date.now()`. Dates must arrive as parameters.
- Money uses floats for accumulated amounts, or `toFixed` to compute.
- Rounding is used without a comment that cites the business rule (e.g. `// RN-4.16`).
- A domain function throws for an expected business-rule error instead of returning `Result`.
- A new domain function that computes money has no test whose name includes its RN-x.y ID.

## Dates

REJECT if:
- New code calls `getFullYear()`, `getMonth()` or `getDate()` on server dates instead of `shared/domain/fechas.ts` (America/Bogota).

## Writes and security

REJECT if:
- Hardcoded secrets, passwords, API keys or tokens.
- A route handler or server action writes to the database directly instead of validating with Zod and calling a use case.
- The Supabase admin (service_role) client is used outside `src/modules/*/infra` or `src/lib/supabase/admin.ts`.
- A write that touches several tables is done with separate calls instead of one transactional RPC.
- An error in a money operation is logged with `console.error` and execution continues as if it succeeded.
- Business logic is added to a `"use client"` component.

## SQL migrations (`supabase/migrations/*.sql`)

REJECT if:
- An already existing migration file is edited (only new migration files are allowed).
- A new table has no `enable row level security` and explicit policies in the same migration.
- A new table has no explicit `grant` for the roles that need it (default privileges are revoked).
- A new function is granted `execute` to `anon` without a comment that justifies it.
- The file name is not `YYYYMMDDHHMMSS_description.sql` (14 digits).
- Money calculations are implemented in SQL instead of the domain (ADR-001).

## TypeScript

REJECT if:
- New `any` types, or `as unknown as` casts on data that comes from the database (validate with Zod instead).
- Empty catch blocks.

PREFER:
- English for code identifiers in new modules; Spanish user-facing messages, clear and without jargon.
- Small pure functions with a verb name (`calcular…`, `validar…`, `aplicar…`).
