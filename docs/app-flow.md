# AppFlow: Ahorro Familiar

> Este documento describe **qué pantallas tiene la app, quién las ve y cómo se navega** en cada flujo.
> Las reglas que cita (RN-x.y) están en [reglas-negocio.md](./reglas-negocio.md).
>
> **Versión:** 0.1 · **Fecha:** 2026-10-14
> **Leyenda de estado:** 🟢 existe y se mantiene · 🟡 existe y cambia · 🔵 nueva · ⚪ fase 2

---

## 1. Navegación

### 1.1 Un menú, dos secciones
Como **todo usuario es accionista** y algunos además administran, el menú deja de cambiar según un rol único y pasa a tener **dos secciones**:

```
┌──────────────────────────┐
│  MI CUENTA               │  ← todos
│   Mi capital             │
│   Comprar y pagar        │
│   Préstamos              │
│   Historial              │
│   Extracto               │
│   Ajustes                │
├──────────────────────────┤
│  ADMINISTRACIÓN          │  ← solo gerente y tesorero
│   Inicio admin           │
│   Por firmar  (gerente)  │
│   Solicitudes de ingreso │
│   Accionistas            │
│   Préstamos              │
│   Libro de caja          │
│   Libro de accionista    │
│   Extractos              │
│   Gastos puntuales (T)   │
│   Parámetros (T)         │
│   Auditoría              │
│   Periodo                │
└──────────────────────────┘
(T) = solo tesorero; el gerente lo ve en modo lectura o no lo ve.
```

- **Celular:** barra inferior con las 4 entradas principales de "Mi cuenta" (Mi capital, Comprar, Préstamos, Más). La sección de administración se abre desde "Más".
- **Escritorio:** menú lateral con las dos secciones.

### 1.2 Pendientes (campana)
La app ya tiene un panel de pendientes, que se mantiene y amplía:

| Para | Pendiente |
|---|---|
| Accionista | Préstamos esperando tu voto · recibos por reenviar · acciones por préstamo por pagar · préstamos desembolsados · **multa en curso** 🔵 |
| Tesorero | Solicitudes de ingreso · recibos por aprobar · préstamos en revisión · préstamos por desembolsar |
| Gerente | 🔵 **Firmas pendientes** (préstamos y desembolsos del tesorero) · 🔵 **avisos** de recibos propios del tesorero |

---

## 2. Inventario de pantallas

### 2.1 Públicas
| Ruta | Pantalla | Estado |
|---|---|---|
| `/` | Inicio | 🟢 |
| `/login` | Inicio de sesión con número de documento | 🟢 |
| `/forgot-password`, `/update-password` | Recuperación de contraseña | 🟢 |
| `/verify-email-change` | Confirmación de cambio de correo | 🟢 |
| `/solicitud`, `/solicitud/confirmacion` | Solicitud de ingreso al banco | 🟢 |

### 2.2 Mi cuenta (todos)
| Ruta | Pantalla | Estado | Cambio |
|---|---|---|---|
| `/dashboard/accionista` | **Mi capital:** acciones, capitalizaciones, utilidades, deuda y multa en curso | 🟡 | Datos desde casos de uso del servidor, no calculados en el cliente |
| *(modal)* | **Elegir valor de acción del periodo** | 🔵 | Bloquea la compra hasta elegir (RN-2.3) |
| `/dashboard/compras` | **Comprar y pagar:** acciones, multas y pagos a préstamos en un solo recibo | 🟡 | Intereses primero y abonos parciales (RN-4.24 y 4.25) |
| `/dashboard/prestamos` | Mis préstamos: saldo, intereses, cuota pactada y estado | 🟡 | |
| `/dashboard/prestamos/nueva` | Solicitar préstamo, con vista previa del neto | 🟡 | Plazo hasta diciembre, acciones con techo y sin mínimo (RN-4) |
| `/dashboard/prestamos/[id]` | Detalle del préstamo: plan, pagos y votación | 🟡 | |
| `/dashboard/prestamos/votar` | Préstamos por votar | 🟡 | Sin el solicitante y con rechazo automático (RN-4.6 a 4.8) |
| `/dashboard/historial` | Mis recibos y su estado | 🟢 | |
| `/dashboard/extracto` | Extracto del periodo | 🟡 | Utilidades calculadas en el dominio |
| `/dashboard/ajustes` | Perfil, cuentas bancarias y correo | 🟡 | Los parámetros del sistema salen de aquí a su propia pantalla |

### 2.3 Administración (gerente y tesorero)
| Ruta | Pantalla | Quién | Estado | Cambio |
|---|---|---|---|---|
| `/dashboard/admin` | Inicio admin: caja, pendientes e indicadores | G, T | 🟡 | |
| `/dashboard/admin/firmas` | **Por firmar:** aprobar o rechazar lo propio del tesorero | G | 🔵 | RN-9.4 |
| `/dashboard/solicitudes` | Solicitudes de ingreso | T (G lee) | 🟢 | |
| `/dashboard/miembros` | Accionistas | T (G lee) | 🟡 | Asignar `admin_role` |
| `/dashboard/admin/prestamos` | Préstamos: revisión, votación y desembolso | T (G lee) | 🟡 | Excepción de acciones con motivo y desembolso atómico |
| `/dashboard/admin/prestamos/[id]` | Detalle y acciones del préstamo | T (G lee) | 🟡 | Saldo, cuota pactada y cuota para cerrar el año |
| `/dashboard/libro-caja` | Libro de caja: aprobar, rechazar y anular recibos | T (G lee) | 🟡 | Anulación con motivo, sin borrar |
| `/dashboard/admin/libro-accionista` | Libro por accionista | G, T | 🟢 | |
| `/dashboard/admin/extractos` | Extractos de todos | G, T | 🟢 | |
| `/dashboard/admin/gastos` | **Gastos puntuales** | T (G lee) | 🔵 | RN-7.2 |
| `/dashboard/admin/parametros` | **Parámetros ⚙️** | T (G lee) | 🔵 | Antes estaba en Ajustes |
| `/dashboard/admin/auditoria` | **Auditoría:** filtrable por actor, entidad y fecha | G, T | 🔵 | RN-9 |
| `/dashboard/admin/periodo` | **Periodo:** apertura e importación de saldos iniciales | T | 🔵 | F1.6 |
| `/dashboard/admin/resumen` | Resumen y **liquidación** | G, T | ⚪ | Fase 2: liquidación en el servidor |

---

## 3. Flujos

### 3.1 Ingreso y primer uso
```mermaid
flowchart TD
  A[Persona llena /solicitud] --> B[Solicitud pendiente]
  B --> C{Tesorero revisa}
  C -- Rechaza --> D[Correo de rechazo]
  C -- Aprueba --> E[Se crea la cuenta y se envía el correo]
  E --> F[Inicio de sesión con número de documento]
  F --> G{¿Eligió valor de acción este periodo?}
  G -- No --> H[Modal: elegir 10.000, 25.000 o 50.000]
  H --> I[Mi capital]
  G -- Sí --> I
```

### 3.2 Comprar acciones y pagar préstamos (un solo recibo)
```mermaid
flowchart TD
  A[Comprar y pagar] --> B[Elegir cantidad de acciones 1 a 10]
  B --> C[Multas en curso se agregan solas RN-3.4]
  C --> D{¿Pagar algún préstamo?}
  D -- Sí --> E[Elegir préstamo y monto]
  E --> F[Vista previa: primero intereses, después capital RN-4.24]
  F --> G
  D -- No --> G[Medio de pago: efectivo o transferencia a cuenta del banco]
  G --> H[Adjuntar comprobante]
  H --> I[Confirmar resumen]
  I --> J[Recibo pendiente]
  J --> K{Tesorero revisa}
  K -- Rechaza con motivo --> L[El accionista corrige y reenvía]
  L --> J
  K -- Aprueba --> M[RC en Libro de caja · saldos actualizados · auditoría]
  M --> N{¿El recibo es del propio tesorero?}
  N -- Sí --> O[Marca en auditoría y aviso al gerente RN-9.4]
```

### 3.3 Préstamo: de la solicitud al pago
```mermaid
flowchart TD
  A[Solicitar préstamo] --> B[Monto, plazo hasta diciembre y plan pactado]
  B --> C[Vista previa: acciones con techo, 4x1000 y neto]
  C --> D{Acciones por préstamo}
  D -- Por adelantado --> E1[Marcar adelantado]
  D -- Descontadas --> E2[Se restan del neto]
  E1 --> F
  E2 --> F[Enviar · estado: revisión]
  F --> G{Tesorero revisa}
  G -- Rechaza con motivo --> X[Rechazado]
  G -- Ajusta acciones con motivo RN-4.12 --> H
  G -- Aprueba --> H[Votación: todos menos el solicitante]
  H --> I{¿Mitad + 1 a favor?}
  I -- Imposible llegar --> X2[Rechazo automático con observación RN-4.8]
  I -- Sí --> J{¿Acciones por adelantado pagadas?}
  J -- No --> J1[Espera el pago de las acciones] --> J
  J -- Sí --> K{¿El préstamo es del tesorero?}
  K -- Sí --> L[Firma del gerente] --> M
  K -- No --> M[Desembolso atómico: CE, 4x1000 y auditoría]
  M --> N[Activo: intereses mes a mes RN-4.18]
  N --> O[Pagos desde Comprar y pagar]
  O --> P{¿Saldo e intereses en 0?}
  P -- No --> N
  P -- Sí --> Q[Pagado]
```

### 3.4 Gasto puntual (tesorero)
```mermaid
flowchart LR
  A[Gastos puntuales] --> B[Concepto y porcentaje]
  B --> C[Vista previa: monto fijo y aporte de cada accionista]
  C --> D[Confirmar]
  D --> E[Foto guardada · CE · auditoría]
```

### 3.5 Cambio de parámetros (tesorero)
```mermaid
flowchart LR
  A[Parámetros] --> B[Editar valor]
  B --> C[Motivo obligatorio]
  C --> D[Confirmar: no afecta préstamos ya creados]
  D --> E[Guardado · auditoría]
```

### 3.6 Firma del gerente
```mermaid
flowchart LR
  A[Aviso: firma pendiente] --> B[Por firmar]
  B --> C[Detalle del préstamo o desembolso del tesorero]
  C --> D{Decisión}
  D -- Aprueba --> E[Continúa el flujo · auditoría]
  D -- Rechaza con motivo --> F[Se detiene · aviso al tesorero · auditoría]
```

### 3.7 Apertura del periodo 2027 (una sola vez, en enero)
```mermaid
flowchart TD
  A[Periodo] --> B[Cargar saldos de la liquidación 2026]
  B --> C[Capitalización de enero 30% · capitalizaciones voluntarias · Deuda año anterior]
  C --> D[Validación: totales contra el Sheet]
  D -- No cuadra --> E[Ver diferencias por accionista y corregir]
  E --> D
  D -- Cuadra al peso --> F[Confirmar apertura · auditoría]
  F --> G[Los accionistas eligen su valor de acción]
```

### 3.8 Liquidación (fase 2) ⚪
```mermaid
flowchart TD
  A[Resumen y liquidación] --> B{¿Alguien debe intereses?}
  B -- Sí --> C[Bloqueado: lista de quién debe y cuánto RN-8.1]
  B -- No --> D[Cálculo por accionista RN-8.2]
  D --> E[Cada accionista decide cuánta deuda traslada RN-8.5]
  E --> F[Revisión y confirmación del tesorero]
  F --> G[CE de devoluciones · Deuda año anterior · capitalización de enero · nuevo periodo]
```

---

## 4. Principios de navegación
- **Máximo 3 toques** para las tareas frecuentes: pagar acciones, ver mi deuda y votar.
- **Antes de cualquier acción de dinero**, una pantalla de **confirmación con el resumen** de lo que va a pasar.
- **Toda pantalla administrativa** muestra claramente si el usuario está en modo lectura (gerente).
- Después de cada acción, mostrar **el resultado y el siguiente paso**, por ejemplo: "Recibo enviado. El tesorero lo revisará".
