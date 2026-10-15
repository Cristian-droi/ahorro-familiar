# PRD: Ahorro Familiar

> **Documento de requerimientos del producto.** Define **qué** hace la app, **para quién** y **qué entra en cada fase**.
> El **cómo** se calcula todo está en [reglas-negocio.md](./reglas-negocio.md), que es la fuente de verdad de las reglas.
>
> - **Versión:** 0.1 (borrador)
> - **Fecha:** 2026-10-14
> - **Dueño del producto:** Cris
> - **Cliente:** grupo Ahorro Familiar

---

## 1. Problema

El grupo Ahorro Familiar funciona hace más de 5 años y tiene unos 31 accionistas. Todo se maneja en un Google Sheet de 44 hojas, y eso trae varios problemas:

- **Errores silenciosos.** Hay deudores sin hoja propia cuya deuda cuenta como 0 en la liquidación, fórmulas con valores escritos a mano y dos cálculos distintos del mismo préstamo.
- **Dependencia de una persona.** Solo quien entiende el Sheet puede operarlo.
- **Poca transparencia.** Los accionistas no ven su estado (acciones, multas, deuda, utilidades) sin pedirlo.
- **Procesos manuales.** Facturación, mes aplicado, acciones por préstamo y votaciones se manejan a mano o por fuera del sistema.
- **Sin trazabilidad.** No queda registro de quién cambió qué ni por qué.

## 2. Objetivo

Reemplazar el Google Sheet por una aplicación web que:

1. **Calcule correctamente** todo lo que está en `reglas-negocio.md`, cubierto por tests automáticos.
2. **Le dé autonomía al accionista** para ver su estado, comprar acciones, pagar préstamos y votar.
3. **Le dé control al administrador** con aprobaciones, parámetros, auditoría y reportes.
4. **Deje trazabilidad completa** de cada peso y de cada decisión.

## 3. Usuarios y roles

**Todo usuario es accionista.** Los roles administrativos se **suman** al de accionista, no lo reemplazan: el gerente y el tesorero también compran acciones, piden préstamos y votan.

| Rol | Quiénes | Permisos |
|---|---|---|
| **Accionista** | Todos (unos 31), incluidos el gerente y el tesorero | Ver su estado, comprar acciones, solicitar y pagar préstamos, votar |
| **Gerente** | 1 persona | Lo del accionista, más **lectura de toda la información** de todos los accionistas. Única escritura: la **segunda firma** sobre los préstamos y desembolsos del propio tesorero. |
| **Tesorero** | Cris | Lo del accionista, más **todos los permisos administrativos**: aprobar, desembolsar, cambiar parámetros y liquidar |

**Control de conflicto de interés** (ver RN-9.4):
- **Préstamos y desembolsos del propio tesorero:** necesitan **doble firma**, es decir, aprobación del gerente.
- **Recibos propios del tesorero** (acciones, pagos): los aprueba él mismo, pero se **marcan en la auditoría** y el gerente **recibe un aviso**.

**Consideración de diseño:** hay accionistas mayores o con poca experiencia digital. La app tiene que ser **muy simple**, pensada para celular primero, con textos claros y sin jerga contable.

## 4. Alcance por fases

### Fecha clave
- **Diciembre de 2026:** liquidación del periodo 2026 **en el Sheet** y **demo de la app** a los accionistas en esa reunión.
- **Enero de 2027:** la app pasa a ser el **sistema oficial**. El Sheet se archiva como solo lectura.

### Fase 1: MVP (operación de enero a noviembre), lista para la demo

**Fundamentos**
- F1.1 **Corrección de las diferencias** con las reglas de negocio (tabla de la sección 11 de `reglas-negocio.md`).
- F1.2 **Seguridad:** RLS completa, migración de `system_settings` y bloqueo de la edición de tasas por el accionista.
- F1.3 **Parámetros ⚙️:** el administrador configura todos los valores de la sección 10 de las reglas.
- F1.4 **Auditoría:** registro de solo-agregar de toda acción del administrador.
- F1.5 **Zona horaria:** America/Bogota en todos los cálculos.

**Saldos iniciales (crítico, nuevo)**
- F1.6 **Importación de apertura 2027:** carga, desde la liquidación 2026, de la capitalización de enero (30%), las capitalizaciones voluntarias y la Deuda año anterior por accionista. Debe ser validable: el total importado tiene que coincidir con el Sheet.

**Accionista**
- F1.7 Elección del valor de acción del periodo, que bloquea la compra hasta definirlo.
- F1.8 Compra de acciones con cálculo de multas, pagada en efectivo o por transferencia a una cuenta del banco.
- F1.9 Solicitud de préstamo con cálculo de acciones por préstamo, 4x1000 y neto a recibir.
- F1.10 Votación de préstamos.
- F1.11 Pago y abono a préstamos: intereses primero, abono parcial permitido, préstamos independientes.
- F1.12 Panel y extracto: acciones, multas, préstamos (saldo, intereses, cuota pactada) y utilidades.

**Administrador**
- F1.13 Aprobación y rechazo de recibos (comprobantes).
- F1.14 Revisión de préstamos, con excepción en acciones por préstamo que exige motivo.
- F1.15 Desembolso **atómico**, con bloqueo si las acciones se pagan por adelantado y aún no están pagas.
- F1.16 Vista de deuda por accionista: saldo, cuota pactada y cuota para cerrar el año.
- F1.17 Libro de caja con anulaciones.
- F1.18 Gestión de miembros y solicitudes de ingreso.
- F1.19 Gastos puntuales con foto por accionista.

> **Fase 1b (enero–febrero de 2027):** de la lista anterior, la doble firma (parte de F1.4 y de RN-9.4), F1.19 (gastos puntuales), la interfaz de parámetros (F1.3) y la vista de auditoría salen **después** del lanzamiento, con mitigaciones temporales (ver `roadmap.md`). La **escritura** de la auditoría sí está en la fase 1.

### Fase 2: cierre de periodo (antes de diciembre de 2027)
- F2.1 **Liquidación anual** en el servidor, con el invariante de intereses en 0 y el ejemplo de Juan como test.
- F2.2 Capitalización voluntaria con reserva.
- F2.3 Traslado de deuda a voluntad y creación automática de la Deuda año anterior.
- F2.4 Devoluciones como CE, en efectivo o por transferencia.
- F2.5 Apertura automática del periodo siguiente.

### Fase 3: después
- F3.1 Indicadores de apoyo para aprobar préstamos (aportes, capacidad de pago, historial).
- F3.2 Notificaciones (correo o WhatsApp) de multas, votaciones y desembolsos.
- F3.3 Estadísticas históricas.
- F3.4 Importación de años anteriores (2018–2025).

### Fuera de alcance
- Integración directa con bancos o pasarelas de pago. Los pagos se registran con comprobante.
- App móvil nativa. La app web es *responsive*.
- Multi-grupo (varios bancos familiares en la misma instancia).

## 5. Criterios de éxito

| Métrica | Meta |
|---|---|
| Cuadre con el Sheet | Los saldos iniciales importados coinciden **al peso** con la liquidación 2026 |
| Reglas cubiertas por tests | 100% de las reglas con ejemplo numérico tienen su test |
| Adopción | En febrero de 2027, al menos el 80% de los accionistas registra sus pagos en la app |
| Errores de dinero | 0 diferencias reportadas en los extractos durante el primer trimestre |
| Sheet | No se usa operativamente desde enero de 2027 |

## 6. Restricciones

- **Capacidad:** Cris dedica **unas 8 horas por semana** (replanificado el 2026-10-15, porque comparte el tiempo con el Trabajo Integrador de la maestría), lo que da cerca de 72 horas hasta la demo. Parte de la fase 1 pasa a la **fase 1b** (enero–febrero de 2027). Ver `roadmap.md`.
- **Datos reales:** el Sheet es **solo lectura**. El desarrollo usa datos de prueba.
- **Stack existente:** Next.js 16, React 19, Supabase, Zod, Tailwind 4 y Vitest. Se conserva (ver `arquitectura.md`).
- **Costo:** debe funcionar con los planes gratuitos o de bajo costo de Supabase y del hosting.

## 7. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| No llegar a la demo con 8 h/semana | Alto | Fase 1b para lo no esencial, lista de recorte y plan B (ver `roadmap.md`) |
| Saldos iniciales mal importados | Crítico | Validación automática contra los totales del Sheet antes de abrir 2027 |
| Accionistas que no adoptan la app | Medio | Demo en la liquidación, UI simple, el administrador puede registrar por ellos |
| Reglas 🟡 sin validar con el gerente | Medio | Validar antes de implementar esas reglas |
| Bug en un cálculo de dinero | Crítico | Tests con ejemplos reales y auditoría para rastrear |

## 8. Preguntas abiertas
1. 🟡 Los dos temas del gerente, que están en `reglas-negocio.md`, sección 12.
2. 🟡 Plan de producción (Supabase Pro o plan gratuito con backups propios) y quién lo paga. Ver `arquitectura.md`, sección 9.
