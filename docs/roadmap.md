# Roadmap: Ahorro Familiar

> Plan de trabajo hacia la **demo de diciembre de 2026** y la salida a producción en **enero de 2027**. El alcance está en [prd.md](./prd.md).
>
> - **Capacidad planificada:** 12 h por semana (unas 3 entre semana y 8 a 9 el fin de semana). 18 h es el mejor escenario.
> - **Versión:** 0.1 · **Fecha:** 2026-10-14

---

## Reglas del roadmap

1. **Revisión cada domingo:** ¿qué se terminó?, ¿cuántas horas reales se usaron?, ¿vamos adelantados o atrasados?
2. **"Terminado"** significa: tests en verde, lint y tipos sin errores, commit en su rama y PR mergeado.
3. **Si hay atraso**, se recorta de la lista de recorte (al final), **nunca** de la calidad de los cálculos de dinero.
4. Las horas que sobren se usan primero como colchón y después para adelantar tareas.

## Plan semanal

| Semana | Fechas | Entregable | Horas |
|---|---|---|---|
| **S0** | 14–18 oct | **Diseño y modelo:** AppFlow, Design Brief, Backend Schema · orden del repositorio | 10 |
| **S1** | 19–25 oct | **Cimientos:** Supabase local, migraciones reproducibles, `shared/domain`, estructura `modules/`, ESLint de fronteras | 12 |
| **S2** | 26 oct – 1 nov | **Dominio con TDD:** acciones, multas y cálculos de préstamos, con las diferencias corregidas | 12 |
| **S3** | 2–8 nov | **Seguridad y control:** roles nuevos, bloqueo de escrituras con RLS, auditoría y doble firma | 12 |
| **S4** | 9–15 nov | **Préstamos de punta a punta:** desembolso atómico, pagos (intereses primero, parciales) y votación con rechazo automático | 12 |
| **S5** | 16–22 nov | **Utilidades y panel:** utilidades calculadas en el dominio, extracto, parámetros configurables y gastos puntuales | 12 |
| **S6** | 23–29 nov | **UI/UX:** aplicar el sistema de diseño a las pantallas clave, con el celular primero | 12 |
| **S7** | 30 nov – 6 dic | **Arranque 2027:** importación de saldos iniciales con validación, datos de demo y despliegue | 12 |
| **S8** | 7–13 dic | **Colchón y ensayo:** corrección de bugs, ensayo de la demo y guía corta para accionistas | 12 |
| **S9** | 14–19 dic | **Colchón final:** solo correcciones. **Congelamiento del código el 18 de diciembre.** | hasta 12 |
| | | **Total planificado** (S0 a S8) | **~106** |

> 🎤 **Demo: 20 de diciembre de 2026**, en la reunión de liquidación. La capacidad hasta esa fecha es de unas 108 h: el plan cabe con S9 como colchón.

---

## Detalle por semana

### S0 · Diseño y modelo (14–18 oct)
- [ ] `docs/app-flow.md`: flujos del accionista, del tesorero y del gerente, con las pantallas y la navegación (diagramas Mermaid).
- [ ] `docs/design-brief.md`: principios de UX, paleta, tipografía, iconografía (lucide), componentes, estados y tono de los textos. **Parte de lo que ya existe** (`theme.ts`, `components/ui`).
- [ ] `docs/modelo-datos.md` (Backend Schema): tablas actuales y nuevas (`audit_log`, `approvals`, `admin_role`, periodos, gastos puntuales), relaciones, RLS e índices.
- [ ] `.gitattributes` (LF), script `npm test` y nombre del paquete (`tmp_app` → `ahorro-familiar`).
- [ ] Integrar `wip/respaldo-2026-10` a `master` mediante un PR.

### S1 · Cimientos (19–25 oct)
- [ ] Supabase local funcionando (`supabase start`) con **todas** las migraciones aplicadas desde cero.
- [ ] Migración de `system_settings` con RLS (riesgo #1 del diagnóstico).
- [ ] `shared/domain`: `Money`, `fechas.ts` (Bogotá), `Result`.
- [ ] Estructura `src/modules/` y regla de ESLint de fronteras entre capas.
- [ ] Eliminar credenciales fijas de `scripts/seed.mjs` y sacar `supabase/.temp` de Git.

### S2 · Dominio con TDD (26 oct – 1 nov)
- [ ] `acciones/domain`: valor de acción por periodo, límites y multas (RN-2, RN-3).
- [ ] `prestamos/domain`: acciones por préstamo con techo (RN-4.10), 4x1000 (RN-4.16), interés simple sobre el saldo (RN-4.18 y 4.19), media tasa (RN-4.20), mes aplicado (RN-4.15), plazo hasta diciembre (RN-4.3), cuota para cerrar el año (RN-4.7).
- [ ] Votación: mayoría sin el solicitante y rechazo automático (RN-4.6 a 4.8).
- [ ] Aplicación de pagos: intereses primero y abonos parciales (RN-4.24 y 4.25).
- [ ] Mover la lógica de `src/lib/loans.ts`, `fines.ts` y `obligations.ts` y que los callers usen el dominio.

### S3 · Seguridad y control (2–8 nov)
- [ ] `profiles.admin_role` (`gerente` o `tesorero`) en lugar del rol exclusivo, y ajuste de `src/proxy.ts`.
- [ ] RLS: escrituras de dinero solo desde el servidor. Corregir `loans_update_own_draft`.
- [ ] `audit_log` inmutable, escrita en la misma transacción.
- [ ] `approvals`: doble firma para préstamos y desembolsos del tesorero, y aviso al gerente por sus recibos (RN-9.4).

### S4 · Préstamos de punta a punta (9–15 nov)
- [ ] RPC `desembolsar_prestamo` atómica, con bloqueo si las acciones por adelantado no están pagas.
- [ ] Excepción en acciones por préstamo con motivo obligatorio (RN-4.12).
- [ ] Flujo de pago a préstamos en la UI, desde el lado del accionista.
- [ ] Vista del tesorero: saldo, cuota pactada y cuota para cerrar el año.

### S5 · Utilidades y panel (16–22 nov)
- [ ] `utilidades/domain`: participación y reparto mensual (RN-6). Reemplaza los cálculos que hoy se hacen en el cliente.
- [ ] Extracto y panel del accionista alimentados por casos de uso de lectura.
- [ ] Panel de parámetros ⚙️ (sección 10 de las reglas).
- [ ] Gastos puntuales con foto por accionista (RN-7.2).

### S6 · UI/UX (23–29 nov)
- [ ] Aplicar el design brief a: inicio de sesión, panel del accionista, compra de acciones, pago de préstamo, votación y panel del tesorero.
- [ ] Revisión en celular real, con letra grande y contraste suficiente.
- [ ] Estados de carga, vacío y error, y confirmaciones antes de acciones irreversibles.

### S7 · Arranque 2027 (30 nov – 6 dic)
- [ ] Importación de saldos iniciales: capitalización de enero, capitalizaciones voluntarias y Deuda año anterior (F1.6).
- [ ] Validación automática: los totales importados tienen que coincidir con el Sheet **al peso**.
- [ ] Datos ficticios para la demo.
- [ ] Despliegue en Vercel y el Supabase de producción que defina el cliente (🟡 tema 3 del gerente).

### S8 · Colchón y ensayo (7–13 dic)
- [ ] Corrección de bugs.
- [ ] Ensayo completo de la demo.
- [ ] Guía corta para accionistas: "Cómo pagar mis acciones" y "Cómo votar un préstamo".

---

## Lista de recorte (si hay atraso, en este orden)
1. Gastos puntuales (RN-7.2). No se necesitan hasta que ocurra un gasto; puede salir en enero.
2. Pulido visual de las pantallas secundarias. Las pantallas clave se hacen igual.
3. Conciliación programada. Se puede correr a mano en las primeras semanas.
4. Guía para accionistas. Se puede explicar en vivo durante la demo.

**Nunca se recortan:** cálculos con tests, seguridad (RLS y roles), auditoría ni la importación validada de saldos iniciales.

## Hitos externos
- 🟡 **Reunión con el gerente:** validar los 3 temas pendientes **antes de S4**.
- 🎤 **Demo:** 20 de diciembre de 2026, en la reunión de liquidación. Congelamiento del código el 18 de diciembre.
- 🚀 **Salida a producción:** enero de 2027.

## Seguimiento

| Semana | Horas planificadas | Horas reales | Estado | Notas |
|---|---|---|---|---|
| S0 | 10 | | ⏳ | |
