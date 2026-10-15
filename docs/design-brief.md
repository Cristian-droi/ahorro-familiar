# UI/UX Design Brief: Ahorro Familiar

> Define **cómo se ve y cómo se siente** la app. Parte del sistema de diseño que ya existe (`src/app/globals.css`, rediseño de abril de 2026) y lo **ajusta**. No es un rediseño desde cero.
> Las pantallas y los flujos están en [app-flow.md](./app-flow.md).
>
> **Versión:** 0.1 · **Fecha:** 2026-10-14

---

## 1. Para quién diseñamos

- **Unos 31 accionistas de una familia**, de jóvenes a adultos mayores, con niveles de manejo digital muy distintos.
- **Usan sobre todo el celular**, casi siempre una vez al mes, para pagar.
- **Lo que necesitan sentir:** *"Mi plata está clara y segura"*.

## 2. Principios

1. **Claridad antes que densidad.** Una idea principal por pantalla. El monto importante, grande.
2. **Confianza.** Cada peso se explica. Nada de cifras sin contexto ("¿de dónde salen estos 18.000?" → "Intereses de octubre").
3. **El celular primero.** Se diseña a 360px de ancho y después se escala al escritorio.
4. **Accesible para todos.** Letra grande, alto contraste y áreas táctiles amplias.
5. **Sin sorpresas con la plata.** Antes de mover dinero, confirmación con el resumen. Después, el resultado y el siguiente paso.

## 3. Identidad visual ✅

**Se mantiene la identidad actual: verde bosque con neutros cálidos.** Transmite confianza, ahorro y crecimiento, y ya está implementada.

### 3.1 Paleta (tema claro)

| Token | Valor | Uso |
|---|---|---|
| `--color-brand` | `#0A6B3B` | Acción principal, marca, monto destacado |
| `--color-brand-soft` | `#E6F1EA` | Fondos de marca suaves, chips activos |
| `--color-brand-ink` | `#053F22` | Texto sobre `brand-soft` |
| `--color-bg` | `#F7F8F5` | Fondo de página |
| `--color-surface` | `#FFFFFF` | Tarjetas |
| `--color-surface-alt` | `#F0F2ED` | Secciones alternas |
| `--color-border` | `#E3E6DE` | Bordes |
| `--color-text` | `#121511` | Texto principal |
| `--color-text-muted` | `#5B6257` | Texto secundario (contraste ~5,9:1 ✅) |
| `--color-text-subtle` | `#878E82` | ⚠️ **Solo decorativo** (contraste ~3,2:1, no cumple AA). Nunca para montos, instrucciones ni etiquetas de formulario. |
| `--color-success` | `#0A6B3B` | Pagado, aprobado |
| `--color-warn` | `#8A5A00` | Multa en curso, pendiente |
| `--color-danger` | `#A8201A` | Rechazado, deuda vencida, error |
| `--color-info` | `#1F5BA8` | Información neutra, votación |

**Tema oscuro:** se mantiene el actual (clase `.dark`), con el mismo significado de tokens.

### 3.2 Reglas de color
- **Siempre se usan tokens.** Nunca un hex directo en un componente.
- **No se usan los alias heredados** (`--color-primary`, `--color-on-surface`, `--color-surface-container-*`, etc.). Están en `globals.css` solo por compatibilidad y se retiran al tocar cada componente.
- **Un solo botón principal (verde lleno) por pantalla.** Las demás acciones van como secundarias (contorno).
- **El color nunca es la única señal.** Cada estado lleva además ícono y texto ("✓ Pagado", "⚠ Multa en curso").
- **Verde de marca y verde de éxito:** comparten el valor. Para distinguirlos, el éxito siempre lleva ícono de check y la marca nunca.

## 4. Tipografía ✅

| Uso | Tamaño | Peso | Notas |
|---|---|---|---|
| **Texto base** | **16px** | 400 | **Antes era 14px.** Mínimo recomendado para lectura en celular por adultos mayores. |
| Texto secundario | 14px | 400 | Nunca menos de 14px para información útil |
| Etiquetas pequeñas, chips | 13px | 500 | Solo para metadatos |
| Título de pantalla | 24px | 600 | |
| Título de sección | 18px | 600 | |
| **Monto principal** | 32px | 600 | Números tabulares |
| Monto en lista | 16px | 500 | Números tabulares |

- **Familia:** Inter para todo. JetBrains Mono solo para números de comprobante (RC-00123).
- **Números:** siempre `tabular-nums`, para que los montos queden alineados en tablas y listas.
- **Interlineado:** 1,5 para el texto.
- **Implementación:** cambiar `text-[14px]` por `text-[16px]` en `src/app/layout.tsx` y revisar las pantallas, que hoy están ajustadas a 14px (roadmap S6).

## 5. Formato de dinero y fechas

- **Dinero:** `$ 1.250.000`, con punto de miles, sin decimales y con espacio después del signo. Siempre con `format.ts`.
- **Negativos:** `−$ 50.000`, en color peligro y con su explicación.
- **Fechas:** `14 oct 2026` en listas y `14 de octubre de 2026` en detalles y comprobantes.
- **Mes aplicado:** "Octubre 2026".
- **Porcentajes:** `2%` o `2% mensual`, nunca `0.02`.

## 6. Componentes

Están en `src/components/ui`. Se mantienen y se ajustan:

| Componente | Reglas |
|---|---|
| **Button** | Variantes: `primary` (verde lleno, una por pantalla), `secondary` (contorno), `ghost`, `danger`. **Alto mínimo de 48px en celular.** Texto con verbo: "Pagar", "Votar a favor", "Desembolsar". |
| **Input** | Etiqueta siempre visible (no solo un *placeholder*). Error en rojo **debajo** del campo, con el qué y el cómo. Campos de dinero con teclado numérico y formato en vivo. |
| **Card** | Fondo blanco, borde suave y radio de 14px. Una tarjeta = un concepto (un préstamo, un recibo). |
| **Badge** | Estados con ícono + texto: ✓ Aprobado, ⏳ Pendiente, ✕ Rechazado, ⚠ Multa, 🗳 En votación. |
| **Toast** | Confirma el resultado: "Recibo enviado. El tesorero lo revisará". |
| **TopNav** | Se mantiene en escritorio. En celular se agrega una barra inferior (app-flow, sección 1.1). |
| **charts** | Uso mínimo. Un número claro vale más que un gráfico. |

**Nuevos:**
- **ConfirmDialog:** resumen antes de mover plata, con un botón principal y otro para cancelar.
- **MoneyBreakdown:** desglose "de dónde sale este número", por ejemplo intereses + capital = total.
- **EmptyState:** invitación con un verbo ("Todavía no tienes préstamos. Solicitar préstamo").
- **ReadOnlyBanner:** aviso para el gerente: "Estás viendo en modo lectura".

## 7. Iconografía
- **lucide-react**, que ya está instalada. Trazo de 1,75 y tamaño de 20px en línea o 24px en navegación.
- Cada ícono de navegación **va con texto**. Nunca un ícono solo para una acción importante.

## 8. Accesibilidad (mínimos obligatorios)
- **Contraste WCAG AA:** 4,5:1 para el texto normal y 3:1 para el texto grande y los íconos.
- **Áreas táctiles de al menos 44 × 44px.**
- Foco visible al navegar con teclado (`ring-brand`, que ya existe).
- `lang="es"` (ya está).
- Se respeta el zoom del sistema y no se bloquea el pellizco para ampliar.

## 9. Tono de los textos
- **Español colombiano, cercano y claro.**
- ✅ **Se trata al usuario de *tú*** en toda la app: "Tienes", "Paga", "Elige". Nada de *vos* ni de *usted*.
- **Sin jerga contable:** "Lo que debes de intereses" en vez de "Saldo de intereses causados".
- **Botones con verbo:** "Pagar $ 120.000", no "Aceptar".
- **Errores:** qué pasó y qué hacer. "Primero tienes que pagar los intereses de este préstamo ($ 18.000)".
- **Sin culpas:** "No pudimos enviar el recibo. Intenta de nuevo", no "Error al enviar".

## 10. Pantallas prioritarias para la demo (S6)
1. Inicio de sesión
2. Mi capital
3. Comprar y pagar
4. Detalle y pago de un préstamo
5. Votar un préstamo
6. Panel del tesorero
