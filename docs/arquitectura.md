# Arquitectura: Ahorro Familiar

> Este documento explica **cómo** está construida la app. El **qué** está en [prd.md](./prd.md) y las reglas en [reglas-negocio.md](./reglas-negocio.md). Las decisiones importantes se registran en [adr/](./adr/).
>
> **Versión:** 0.1 · **Fecha:** 2026-10-14

---

## 1. Principio rector

> **El dominio calcula y la base de datos protege.** ([ADR-001](./adr/001-dominio-en-typescript.md))

- Todo cálculo de dinero vive en **un solo lugar**: funciones puras de TypeScript en la capa de dominio, con un test por regla (RN-x.y).
- Postgres (Supabase) **no calcula reglas de negocio**. Garantiza tres cosas:
  - **Atomicidad:** o se guarda todo, o no se guarda nada.
  - **Seguridad:** RLS.
  - **Invariantes simples:** restricciones `CHECK` y triggers.

## 2. Stack

Se conserva el stack actual. No hay razón técnica para cambiarlo.

| Capa | Tecnología |
|---|---|
| Framework web | Next.js 16 (App Router) + React 19 |
| Base de datos, auth y realtime | Supabase (Postgres) |
| Validación | Zod 4 |
| Estilos | Tailwind 4 |
| Tests | Vitest 4 |
| Exportaciones | exceljs, jspdf |
| Correo | nodemailer |

> ⚠️ Next.js 16 tiene cambios incompatibles con versiones anteriores. Antes de tocar APIs de Next, consultar `node_modules/next/dist/docs/` (ver `AGENTS.md`).

## 3. Capas

```
┌─────────────────────────────────────────────────────────┐
│  UI y entrada (src/app)                                  │
│  Páginas, componentes, route handlers. SIN reglas.       │
└──────────────────────┬──────────────────────────────────┘
                       │ llama a
┌──────────────────────▼──────────────────────────────────┐
│  Aplicación (src/modules/*/application)                  │
│  Casos de uso: registrarPago, desembolsarPrestamo...     │
│  Orquestan: autorizan → leen → dominio → guardan → audit │
└───────┬──────────────────────────────────┬──────────────┘
        │ usa                              │ usa (vía puertos)
┌───────▼──────────────────┐   ┌───────────▼──────────────┐
│  Dominio                  │   │  Infraestructura          │
│  (src/modules/*/domain)   │   │  (src/modules/*/infra)    │
│  Funciones PURAS.         │   │  Supabase, RPC, correo,   │
│  Sin Supabase, sin Next,  │   │  exportaciones.           │
│  sin fechas del sistema.  │   │  Implementa los puertos.  │
└───────────────────────────┘   └───────────────────────────┘
```

**Regla de dependencias:** las flechas solo van hacia adentro. El dominio **no importa nada** de las otras capas.

### Responsabilidad de cada capa

| Capa | Hace | No hace |
|---|---|---|
| **UI** (`src/app`) | Mostrar, capturar datos, validar formato con Zod y llamar al caso de uso | Calcular plata, tocar Supabase para escribir |
| **Aplicación** | Autorizar (rol y conflicto de interés), cargar datos, llamar al dominio, persistir de forma atómica y auditar | Fórmulas de negocio |
| **Dominio** | Calcular: multas, intereses, acciones por préstamo, 4x1000, utilidades, liquidación, votación | I/O, fechas del sistema, acceso a la base |
| **Infraestructura** | Leer y escribir en Supabase, llamar RPC transaccionales, enviar correos | Decidir reglas |

## 4. Estructura de carpetas (Screaming Architecture)

Las carpetas **gritan el negocio**, no el framework.

```
src/
├── app/                       ← Next.js: rutas, páginas, route handlers (delgados)
├── modules/
│   ├── acciones/              ← valor de acción, compras, multas
│   │   ├── domain/
│   │   ├── application/
│   │   └── infra/
│   ├── prestamos/             ← solicitud, votación, desembolso, intereses, pagos
│   ├── caja/                  ← libro de caja, recibos RC/CE, anulaciones
│   ├── utilidades/            ← participación, reparto, gastos puntuales
│   ├── liquidacion/           ← cierre de periodo (fase 2)
│   ├── periodos/              ← apertura e importación de saldos iniciales
│   ├── miembros/              ← accionistas, solicitudes de ingreso, roles
│   ├── parametros/            ← system_settings
│   └── auditoria/             ← registro de solo-agregar, doble firma
├── shared/
│   ├── domain/                ← Money, fechas Bogotá, Result, errores de dominio
│   └── infra/                 ← clientes de Supabase (server y admin), correo
└── components/ui/             ← componentes visuales reutilizables
```

## 5. Decisiones transversales

### 5.1 Dinero
- Montos en **pesos enteros** (COP, sin centavos). Tipo `number` entero en TypeScript y `bigint` o `numeric(14,0)` en Postgres.
- El redondeo se aplica **solo** donde la regla lo indica, con `Math.round` (4x1000, intereses, utilidades).
- Toda función de dominio que devuelve dinero tiene un test con un ejemplo de `reglas-negocio.md`.

### 5.2 Fechas y zona horaria
- **Todo** en `America/Bogota`. Un único módulo `shared/domain/fechas.ts` expone `hoyBogota()`, `mesAplicado(fecha)`, `diaDelMes(fecha)`.
- El dominio **recibe la fecha como parámetro** y nunca llama a `new Date()`. Así los tests pueden fijar "hoy".

### 5.3 Parámetros
- Todos los valores ⚙️ viven en `system_settings`, que tendrá su migración versionada con RLS: lectura para autenticados y escritura solo para el tesorero.
- **Foto al crear:** cada préstamo guarda la tasa, el 4x1000 y el paso de acciones **vigentes cuando se creó**. Cambiar un parámetro **nunca** cambia préstamos ya creados.

### 5.4 Roles y permisos
- **Todo usuario es accionista.** Además, `profiles.admin_role` puede ser `null`, `gerente` o `tesorero`.
- Reemplaza el enum actual `role` (`admin` | `accionista`) y la redirección exclusiva de `src/proxy.ts`. El gerente y el tesorero ven el área de accionista **y** el área administrativa.
- La autorización se valida **en el caso de uso**, en el servidor, nunca solo en la UI:
  - `tesorero`: todas las escrituras administrativas.
  - `gerente`: lectura total y **segunda firma** (RN-9.4).
- **Doble firma** (RN-9.4): una tabla `approvals` registra las acciones pendientes de segunda firma. El caso de uso no ejecuta el desembolso mientras falte la firma del gerente.

### 5.5 Libro de caja
- `receipts` y `receipt_items` son el libro de caja. **Nunca se borran:** se anulan con un estado y un motivo (RN-1.2).
- Saldos, utilidades y deudas **se derivan** del libro. Si algún valor se guarda por rendimiento (por ejemplo, `outstanding_balance`), la conciliación lo verifica.

### 5.6 Escrituras atómicas
- Cada operación que toca varias tablas usa **una función SQL transaccional (RPC)**: `desembolsar_prestamo`, `aprobar_recibo`, `registrar_gasto_puntual`, `liquidar_periodo`.
- El caso de uso **calcula en TypeScript** y le pasa a la RPC los valores ya calculados. La RPC **valida invariantes y guarda todo o nada**.
- Esto reemplaza las escrituras sueltas que tiene hoy `disburse/route.ts`.

### 5.7 Auditoría
- La tabla `audit_log` es **solo de agregar**: sin `UPDATE` ni `DELETE` para ningún rol, garantizado con un trigger que lo impide.
- Columnas: `actor_id`, `accion`, `entidad`, `entidad_id`, `antes`, `despues` (jsonb), `motivo`, `es_propio` (bandera de conflicto de interés), `created_at`.
- La escribe el caso de uso **dentro de la misma transacción** que el cambio.

## 6. Defensa en profundidad

Estas capas evitan que alguien se salte el dominio:

| # | Capa | Mecanismo | ¿Automática? |
|---|---|---|---|
| 1 | La base no deja escribir desde el navegador | RLS: `INSERT`, `UPDATE` y `DELETE` denegados para usuarios en las tablas de dinero. Solo escribe el servidor. | ✅ |
| 2 | Una sola puerta en el servidor | Las escrituras pasan solo por casos de uso. ESLint (`no-restricted-imports` o `eslint-plugin-boundaries`) impide importar `shared/infra/supabase/admin` fuera de `*/infra`, y el `domain` no puede importar nada de afuera. CI falla si se viola. | ✅ |
| 3 | Invariantes en la base | `CHECK` (montos ≥ 0, cantidad de acciones dentro del rango), triggers (no liquidar con intereses pendientes, auditoría inmutable) | ✅ |
| 4 | Conciliación | Chequeo que recalcula saldos desde el libro y compara con lo guardado | ✅ (programado) |
| 5 | Auditoría | RN-9 | ✅ |
| 6 | Convenciones | Reglas en `CLAUDE.md` y `convenciones.md`, más revisión de código | Manual |

## 7. Estrategia de tests

| Nivel | Qué prueba | Herramienta | Cantidad |
|---|---|---|---|
| **Dominio** | Cada regla RN-x.y con su ejemplo numérico | Vitest, sin base de datos | La mayoría |
| **Aplicación** | Casos de uso con repositorios en memoria: autorización, doble firma, orden de operaciones | Vitest | Media |
| **Integración** | RPC transaccionales, RLS y triggers contra un Supabase local | Vitest + `supabase start` | Pocas, solo las críticas |

- Se agrega el script `npm test` a `package.json`.
- **Obligatorio:** el ejemplo de liquidación de Juan (RN-8, sección 8.3) es un test de dominio.

## 8. Migración desde el código actual

**Incremental, no reescritura total.** El código actual funciona y tiene mucho valor.

1. Crear `shared/domain` (Money, fechas) y la estructura `modules/`.
2. Mover la lógica de `src/lib/loans.ts`, `fines.ts` y `obligations.ts` a `modules/*/domain`, **agregando los tests primero**.
3. Corregir las diferencias de `reglas-negocio.md`, sección 11, una por una, cada una con su test.
4. Migrar los route handlers a casos de uso, empezando por el **desembolso**, que es el más riesgoso.
5. Agregar auditoría, roles nuevos, doble firma y RLS de escritura.
6. Eliminar los cálculos que hoy se hacen en el cliente (resumen, extracto) y reemplazarlos por casos de uso de lectura.

## 9. Ambientes y despliegue

**Situación actual (2026-10-14):** la app no está desplegada. Todo corre en local contra **un único proyecto de Supabase en la nube**, que se usa para desarrollo.

**Riesgo:** con datos de dinero, un solo proyecto para todo significa que una prueba o una migración rota afecta los datos reales.

### Propuesta

| Ambiente | Dónde | Costo |
|---|---|---|
| **Desarrollo** | **Supabase local** (CLI + Docker). Sirve también para los tests de integración y para probar migraciones. | Gratis |
| **Pruebas en la nube** | El proyecto actual de Supabase | Gratis |
| **Producción** | **Proyecto nuevo y limpio**, creado solo desde las migraciones versionadas | Ver opciones |
| **Hosting web** | Vercel, plan gratuito | Gratis |

### 🟡 Opciones para producción (decisión del cliente, a tratar con el gerente)

**Riesgos del plan gratuito de Supabase** (revisados el 2026-10-14):
1. **Pausa por inactividad:** los proyectos gratuitos con poca actividad durante 7 días se pausan. Si la familia solo entra en la semana de pagos, la app podría estar apagada cuando alguien la abra. Se puede restaurar desde el panel, pero hay que hacerlo a mano.
2. **Sin backups administrados:** si se pierde o corrompe un dato, no hay forma de recuperarlo.

| Opción | Ventajas | Desventajas |
|---|---|---|
| **(A) Plan Pro de Supabase** (~USD 25/mes, verificar el precio vigente) | Sin pausas y con backups diarios administrados (7 días de retención). Cero mantenimiento. | Costo mensual |
| **(B) Plan gratuito con backups propios** | Gratis | Hay que montar un *dump* programado (por ejemplo, GitHub Actions + `supabase db dump`) y algo que mantenga activa la base. Más piezas que mantener y vigilar. Restaurar es manual. |

**Recomendación: (A)**, pagada por el banco como **gasto operativo**. La app es del grupo, protege la plata de todos, y unos USD 25 al mes divididos entre unos 31 accionistas es un costo mínimo frente al riesgo de perder datos.

## 10. Pendientes de arquitectura
- 🟡 Plan de producción (sección 9). Lo decide el cliente con el gerente.
- ❓ ¿Cómo se ejecuta la conciliación programada (Supabase cron o un route con cron de Vercel)?
