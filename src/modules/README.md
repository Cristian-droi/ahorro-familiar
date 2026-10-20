# src/modules

Módulos de negocio (Screaming Architecture). Cada módulo nace con su primer código, a partir de la S2. Ver [docs/arquitectura.md](../../docs/arquitectura.md), sección 4.

```
modules/<modulo>/
├── domain/        Funciones puras y tipos: dinero y reglas RN-x.y. Sin I/O.
├── application/   Casos de uso: validan, autorizan, llaman al dominio y persisten por puertos.
└── infra/         Repositorios de Supabase, llamadas a RPC y el cliente admin.
```

Módulos previstos: `acciones`, `prestamos`, `caja`, `utilidades`, `liquidacion`, `periodos`, `miembros`, `parametros` y `auditoria`.

## Fronteras (las hace cumplir ESLint)

Están configuradas en `eslint.config.mjs` y fijadas por `src/__tests__/eslint-boundaries.test.ts`.

| Capa | Puede importar | No puede importar |
|---|---|---|
| `domain` (y `src/shared/domain`) | El dominio de su módulo y `@/shared/domain` | Supabase, Next.js, React, `infra`, `application`, `@/app`, `@/components` ni `@/lib`. Tampoco puede usar `new Date()`, `Date.now()`, `fetch` ni `process.env`. |
| `application` | El dominio y los puertos | `infra`, Supabase ni Next.js |
| `infra` | Lo que necesite, incluido el cliente admin de Supabase | — |

El cliente admin de Supabase fuera de `src/modules/*/infra` es un **warning** en el código legado (`src/app`, `src/lib`) hasta que la S4 lleve las escrituras a casos de uso. Ahí pasa a ser un error.
