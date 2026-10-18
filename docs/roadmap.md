# Roadmap: Ahorro Familiar

> Plan de trabajo hacia la **demo del 20 de diciembre de 2026** y la salida a producción en **enero de 2027**. El alcance está en [prd.md](./prd.md).
>
> - **Capacidad: 8 h por semana**, en fines de semana. *(Replanificado el 2026-10-15: antes eran 12 h. Cris reparte su tiempo libre entre el Trabajo Integrador de la maestría, prioridad 2, con 8 h, y este proyecto, prioridad 3, con 8 h.)*
> - **Capacidad hasta la demo:** unas 72 h (S1 a S9).
> - **Versión:** 0.2 · **Fecha:** 2026-10-15

---

## Reglas del roadmap

1. **Revisión cada domingo:** ¿qué se terminó?, ¿cuántas horas reales se usaron?, ¿vamos adelantados o atrasados?
2. **"Terminado"** significa: tests en verde, lint y tipos sin errores, commit en su rama y PR mergeado.
3. **Si hay atraso**, se recorta de la lista de recorte, **nunca** de la calidad de los cálculos de dinero.
4. **Válvula de escape:** si en 2 revisiones seguidas las 16 h semanales (integrador + Ahorro) no se sostienen, se pasa al plan B. El integrador sube a 10 h, Ahorro baja a 4–5 h, y la salida a producción se mueve después de enero.

## Plan semanal

| Semana | Fechas | Entregable | Horas | Estado |
|---|---|---|---|---|
| **S0** | 14–18 oct | Diseño y modelo: AppFlow, Design Brief, Backend Schema, orden del repositorio y merge a `master` | ~10 | ✅ |
| **S1** | 19–25 oct | **Cimientos:** Supabase local, migraciones reproducibles, seguridad base, `shared/domain` | 8 | |
| **S2** | 26 oct – 1 nov | **Dominio I (TDD):** acciones, multas y cálculos de préstamos | 8 | |
| **S3** | 2–8 nov | **Dominio II (TDD):** votación, aplicación de pagos y migración de `src/lib` al dominio | 8 | |
| **S4** | 9–15 nov | **Seguridad:** roles nuevos, bloqueo de escrituras con RLS y `audit_log` | 8 | |
| **S5** | 16–22 nov | **Préstamos:** desembolso atómico y flujo de pago en la UI | 8 | |
| **S6** | 23–29 nov | **Utilidades:** cálculo en el dominio, más extracto y panel servidos desde el servidor | 8 | |
| **S7** | 30 nov – 6 dic | **Arranque 2027:** importación validada de saldos y despliegue | 8 | |
| **S8** | 7–13 dic | **UI/UX:** base de 16px y las 6 pantallas clave, con datos de demo | 8 | |
| **S9** | 14–19 dic | **Colchón y ensayo.** Congelamiento del código el 18 de diciembre. | 8 | |
| | | **Total hasta la demo** | **~72** | |

> 🎤 **Demo: 20 de diciembre de 2026**, en la reunión de liquidación.

---

## Detalle por semana

### S1 · Cimientos (19–25 oct)
- [ ] Supabase local (`supabase start`) con **todas** las migraciones aplicadas desde cero.
- [ ] Migración de `system_settings` con RLS.
- [ ] Revocar los *default privileges* amplios y eliminar `_test_anon_insert`.
- [ ] `shared/domain`: `fechas.ts` (Bogotá) y `Result`.
- [ ] Estructura `src/modules/` y regla de ESLint de fronteras entre capas.
- [ ] Eliminar las credenciales fijas de `scripts/seed.mjs` y sacar `supabase/.temp` de Git.
- [ ] **GGA (revisión automática en cada commit):** `gga install` en el repositorio y un `AGENTS.md` con las reglas clave de `convenciones.md` (dinero solo en el dominio, dominio puro, TDD, fechas en Bogotá, sin secretos). Es la defensa n.º 6 de `arquitectura.md`, ahora automatizada.

### S2 · Dominio I (26 oct – 1 nov)
- [ ] `acciones/domain`: límites y multas (RN-3).
- [ ] `prestamos/domain`:
  - Acciones por préstamo con techo (RN-4.10).
  - 4x1000 (RN-4.16).
  - Interés simple sobre el saldo (RN-4.18 y 4.19).
  - Media tasa (RN-4.20).
  - Mes aplicado (RN-4.15).
  - Plazo hasta diciembre (RN-4.3).
  - Cuota para cerrar el año.
- [ ] Migración: dinero a `bigint`.

### S3 · Dominio II (2–8 nov)
- [ ] Votación: mayoría sin el solicitante y rechazo automático (RN-4.6 a 4.8). Progreso con voto secreto (RN-4.9b).
- [ ] Aplicación de pagos: intereses primero y abonos parciales (RN-4.24 y 4.25).
- [ ] Mover `src/lib/loans.ts`, `fines.ts` y `obligations.ts` al dominio y actualizar los callers.
- [ ] Periodos y valor de acción por periodo (RN-2.2).

### S4 · Seguridad (9–15 nov)
- [ ] `profiles.admin_role` (`gerente` o `tesorero`) y ajuste de `src/proxy.ts` y del menú en dos secciones.
- [ ] RLS: escrituras de dinero solo desde el servidor. Corregir `loans_update_own_draft`.
- [ ] `audit_log` inmutable, escrita por los casos de uso.

### S5 · Préstamos (16–22 nov)
- [ ] RPC `desembolsar_prestamo` atómica, con `cash_outflows` (CE) y bloqueo de acciones por adelantado.
- [ ] Excepción en acciones por préstamo con motivo obligatorio (RN-4.12).
- [ ] Flujo "Comprar y pagar" con pagos a préstamos.

### S6 · Utilidades (23–29 nov)
- [ ] `utilidades/domain` (RN-6). Reemplaza los cálculos que hoy se hacen en el cliente.
- [ ] Mi capital y extracto alimentados por casos de uso de lectura.
- [ ] Vista del tesorero: saldo, cuota pactada y cuota para cerrar el año.

### S7 · Arranque 2027 (30 nov – 6 dic)
- [ ] Importación de saldos iniciales: capitalización de enero, capitalizaciones voluntarias y Deuda año anterior.
- [ ] Validación automática **al peso** contra el Sheet.
- [ ] Despliegue en Vercel y el Supabase de producción que defina el cliente (🟡 tema 3 del gerente).

### S8 · UI/UX (7–13 dic)
- [ ] Letra base de 16px y revisión de las pantallas.
- [ ] Las 6 pantallas clave del design brief, revisadas en un celular real.
- [ ] Datos ficticios para la demo.

### S9 · Colchón y ensayo (14–19 dic)
- [ ] Corrección de bugs. **Congelamiento del código el 18 de diciembre.**
- [ ] Ensayo completo de la demo.

---

## Fase 1b: después del lanzamiento (enero–febrero de 2027)

Se sacaron del plan hasta la demo por falta de capacidad. Ninguna es necesaria para operar enero:

| Funcionalidad | Por qué puede esperar | Mitigación mientras tanto |
|---|---|---|
| **Doble firma** (RN-9.4) | Solo aplica cuando el tesorero pide un préstamo o desembolsa el suyo | Hasta que exista, el gerente aprueba esos casos por fuera de la app, y la auditoría registra la acción marcada como propia |
| **Gastos puntuales** (RN-7.2) | Solo se usan cuando ocurre un gasto | Se registran a mano con un recibo `otros` y se documenta |
| **Panel de parámetros** (UI) | Los parámetros se fijan una vez para 2027 | Se cambian por migración versionada, con registro en la auditoría |
| **Vista de auditoría** (UI) | Los registros se escriben desde la S4 | Consulta directa en Supabase |
| **Conciliación programada** | | Chequeo manual mensual |
| **CI con GitHub Actions** | | Lint, tipos y tests a mano antes de cada PR |
| **Guía para accionistas** | | Explicación en vivo durante la demo |

## Lista de recorte (si hay atraso hasta la demo, en este orden)
1. Pulido visual de pantallas secundarias (S8). Las 6 clave se mantienen.
2. Vista del tesorero con cuota para cerrar el año (S6). Se puede calcular a mano en enero.
3. Excepción de acciones por préstamo en la UI (S5). Se puede hacer por SQL con auditoría.

**Nunca se recortan:** cálculos con tests, seguridad (RLS y roles), escritura de la auditoría ni la importación validada de saldos.

## Hitos externos
- 🟡 **Reunión con el gerente:** validar los 3 temas pendientes **antes de la S5 (16 de noviembre)**.
- 🎤 **Demo:** 20 de diciembre de 2026, con el código congelado el 18.
- 🚀 **Producción:** enero de 2027. Fase 1b en enero y febrero.

## Seguimiento

| Semana | Horas planificadas | Horas reales | Estado | Notas |
|---|---|---|---|---|
| S0 | 10 | 6 | ✅ | Terminada antes de lo previsto (14–15 oct), con 4 h menos de lo estimado |
| S1 | 8 | | ⏳ | |
