# Reglas de negocio: Ahorro Familiar

> **Fuente de verdad** de cómo funciona el banco familiar. Si el código y este documento no coinciden, **el código está mal**, salvo que este documento diga lo contrario.
>
> - **Origen:** análisis del Google Sheet "Ahorro Familiar 2026" más una entrevista con Cris (2026-10-13).
> - **Leyenda:** ✅ confirmada · 🟡 provisional (validar con el gerente) · ❓ abierta (falta definir).
> - **Todo valor marcado como ⚙️ es un parámetro** que el administrador configura. No se escribe fijo en el código.

---

## 0. Conceptos

| Término | Significado |
|---|---|
| **Accionista** | Miembro del banco. Compra acciones, puede pedir préstamos y recibe utilidades. |
| **Periodo** | Un año calendario (enero a diciembre). Al final se **liquida** y el siguiente arranca casi en cero. |
| **Aportes** | Acciones + acciones por préstamo + capitalizaciones + utilidades de un accionista. |
| **Libro de caja** | Registro de **todos** los movimientos de plata. Es la fuente de verdad: todo lo demás se calcula desde aquí. |
| **RC / CE** | Recibo de Caja (entrada de plata) / Comprobante de Egreso (salida de plata). |
| **Mes aplicado** | Mes al que corresponde contablemente un movimiento. Puede diferir de su fecha real. |
| **Saldo pendiente** | Capital que el accionista todavía debe de un préstamo. |
| **Cuota pactada** | Lo que el accionista se comprometió a pagar cada mes (plan del préstamo). |
| **Cuota para cerrar el año** | Saldo pendiente ÷ meses que faltan hasta diciembre. Es el ritmo necesario para quedar en cero. |
| **Deuda año anterior** | Capital que no se pagó en la liquidación y pasa al periodo siguiente. |

---

## 1. Libro de caja ✅

- **RN-1.1** Todo movimiento de plata queda registrado en el Libro de caja con estos datos: fecha, número de comprobante (RC-xxxxx o CE-xxxxx), accionista, concepto, mes aplicado, cantidad o préstamo asociado, valor de entrada o salida y medio de pago.
- **RN-1.2** Los movimientos **nunca se borran**. Si hay un error, se **anulan** con una observación y se registra el movimiento correcto.
- **RN-1.3** Saldos, utilidades, deudas, extractos y liquidación **se calculan a partir del Libro de caja**. No se guardan totales a mano.
- **RN-1.4** Medios de pago:
  - **Entradas:** efectivo o transferencia a **cualquiera** de las cuentas del banco. Se registra a qué cuenta llegó.
  - **Salidas:** efectivo o transferencia a la cuenta **registrada por el accionista**. Se registra a qué cuenta se envió.

---

## 2. Valor de la acción ✅

- **RN-2.1** Cada accionista elige el valor de su acción entre los permitidos ⚙️. Hoy son 10.000, 25.000 y 50.000.
- **RN-2.2** El valor se elige **una sola vez por periodo**, al iniciar el año. **No se puede cambiar a mitad de año.**
- **RN-2.3** Un accionista **no puede comprar acciones** mientras no haya definido el valor de su acción para el periodo.
- **RN-2.4** Cada compra guarda el **valor unitario con el que se hizo**. Los cálculos históricos usan ese valor, nunca el valor actual.
  > ⚠️ El Sheet multiplica el valor actual por el total de acciones. Si alguien cambiara su valor, se recalcularía todo el pasado. La app **no** debe repetir ese error.

---

## 3. Compra de acciones y multas ✅

- **RN-3.1** Cada accionista compra entre **1 y 10 acciones por mes** ⚙️.
- **RN-3.2** La compra de acciones es la **única obligación mensual**.
- **RN-3.3** **Las multas solo se generan por no comprar acciones a tiempo.** Los intereses de los préstamos **no** generan multa.
- **RN-3.4** Cálculo de la multa:
  - **Mes en curso:** días de gracia ⚙️ = 10. Desde el día 11 se cobran 500 por día ⚙️, con tope de 15.000 por mes ⚙️.
    `multa_mes = MIN(MAX(día − 10, 0) × 500, 15.000)`
  - **Meses completos sin comprar:** 15.000 por cada uno ⚙️.
- **RN-3.5** Las multas **no se reparten** como utilidades. Ingresan a la caja del banco.

**Ejemplo:** la última compra fue en julio y hoy es 20 de septiembre.
- Agosto completo sin comprar: **15.000**.
- Septiembre: (20 − 10) × 500 = **5.000**.
- **Multa total: 20.000.**

---

## 4. Préstamos

### 4.1 Solicitud y límites ✅
- **RN-4.1** **Monto mínimo:** opcional ⚙️. Por defecto **no hay mínimo**.
- **RN-4.2** **Préstamos activos por persona:** opcional ⚙️. Por defecto **no hay límite**. El administrador evalúa cada caso.
- **RN-4.3** **Plazo:**
  - Por defecto, hasta **diciembre del periodo actual**. Un préstamo de enero tiene 12 meses de plazo y uno de octubre, 3.
  - El administrador puede habilitar ⚙️ plazos hasta **diciembre del periodo siguiente**. Esos préstamos se financian con la capitalización voluntaria (ver RN-8.4).
- **RN-4.4** Hay una funcionalidad futura (fuera del MVP): indicadores que **ayuden** al administrador a decidir, como aportes, capacidad de pago e historial de pagos. Solo informan, nunca bloquean.

### 4.2 Aprobación por votación ✅
- **RN-4.5** Flujo: **borrador → revisión del administrador → votación → desembolso → activo → pagado**.
- **RN-4.6** Votan **todos los accionistas activos excepto el solicitante**. Sea `n` = número de votantes habilitados.
- **RN-4.7** Se aprueba con **⌊n/2⌋ + 1 votos A FAVOR**. Se cuentan votos a favor, no participación. Quien no vota acepta el resultado.
- **RN-4.8** **Rechazo automático:** se rechaza apenas `votos_en_contra > n − (⌊n/2⌋ + 1)`, es decir, cuando ya es imposible aprobar. Queda una **observación registrada**, por ejemplo: *"Rechazado por votación: 10 en contra de 19 votantes"*.
- **RN-4.9** No se desembolsa sin aprobación ni sin caja suficiente.

**Ejemplo:** hay 20 accionistas, así que n = 19 votantes.
- Se necesitan **10 votos a favor**.
- El rechazo es automático en cuanto hay **10 votos en contra**.

### 4.3 Acciones por préstamo ✅
- **RN-4.10** `acciones_por_préstamo = TECHO(monto / 500.000)` ⚙️ (500.000 es el paso), **sin tope**.
- **RN-4.11** **Excepción:** la "Deuda año anterior" **no** exige acciones por préstamo.
- **RN-4.12** El administrador puede **modificar la cantidad** al aprobar la solicitud. Se registra en la auditoría con el valor sugerido, el valor final, un **motivo obligatorio** y quién hizo el cambio.
- **RN-4.13** Las acciones por préstamo **cuentan como aportes**: suman a la participación en utilidades y a la base del 30% retenido.
- **RN-4.14** ✅ Cada acción por préstamo vale **lo mismo que el valor de acción del accionista** en el periodo. Hay dos formas de pagarlas:
  - **Por adelantado:** el préstamo **no se puede desembolsar** hasta que se registre y apruebe el pago de esas acciones.
  - **Descontadas del desembolso:** su valor se resta del monto a desembolsar.

**Ejemplo:** préstamo de 900.000 con valor de acción de 50.000 → 2 acciones × 50.000 = **100.000**.

**Ejemplos:**
- 900.000 → TECHO(1,8) = **2 acciones**.
- 4.840.000 → TECHO(9,68) = **10 acciones**.
- 11.000.000 → **22 acciones**. En el Sheet se cobraron 20 por una excepción aprobada.

### 4.4 Desembolso
- **RN-4.15** **Mes aplicado:** si el desembolso es **después del día 25** ⚙️, el préstamo cuenta como **del mes siguiente** ✅.
- **RN-4.16** ✅ **4x1000:** se calcula sobre el **neto que realmente sale de la caja**, es decir, después de las deducciones (acciones por préstamo, multas, intereses y capital descontados). Las deducciones no salen de la cuenta, así que no pagan impuesto. *Cambia respecto al Sheet, que lo calculaba sobre el bruto.*
  - `neto_antes_impuesto = monto − deducciones`
  - `4x1000 = REDONDEAR(neto_antes_impuesto × 0,004)`
  - `se transfiere = neto_antes_impuesto − 4x1000`
  - **Ejemplo:** préstamo de 1.000.000 con 100.000 de acciones descontadas → base 900.000 → 4x1000 = 3.600 → se transfieren **896.400**.
- **RN-4.17** El desembolso se registra como CE en el Libro de caja. **Debe ser atómico**: o se registra todo, o no se registra nada.

### 4.5 Intereses ✅
- **RN-4.18** Tasa: **2% mensual** ⚙️ sobre el **saldo pendiente real**, nunca sobre el plan pactado.
- **RN-4.19** **Interés simple:** los intereses atrasados **no** generan intereses.
- **RN-4.20** **Primer mes:** si el desembolso es **después del día 15** ⚙️, se cobra **media tasa (1%)**. Es una regla nueva en la app: el Sheet no la aplica.
- 🟡 **RN-4.21** **Desembolso después del día 25:** el préstamo pasa al mes siguiente, ese mes no cobra intereses y el mes siguiente cobra **tasa completa (2%)**, como si se hubiera desembolsado el día 1. *Validar con el gerente.*
- **RN-4.22** Los intereses se **acumulan mes a mes** como deuda de intereses **de cada préstamo**. No generan multa.

**Ejemplos con un saldo de 1.000.000:**
- Desembolso el 10 de marzo: interés de marzo = **20.000**.
- Desembolso el 20 de marzo: interés de marzo = **10.000** (media tasa).
- Desembolso el 28 de marzo: marzo sin intereses, abril = **20.000** 🟡.
- Tres meses sin pagar: 3 × 2% × 1.000.000 = **60.000**.

### 4.6 Pagos a préstamos ✅
- **RN-4.23** Pagar un préstamo es **voluntario**. Si el accionista solo compra acciones, no se le cobran intereses.
- **RN-4.24** Cuando decide pagar **un préstamo**, el pago se aplica primero a los **intereses acumulados de ese préstamo** y, cuando quedan en cero, a **capital**.
- **RN-4.25** Se permiten **pagos parciales de intereses**. Ejemplo: debe 60.000 y paga 40.000; quedan **20.000 de intereses pendientes** y no se abona nada a capital.
- **RN-4.26** El abono a capital es libre: puede ser igual, mayor o menor que la cuota pactada, o no hacerse.
- **RN-4.27** Cada préstamo es independiente. Con varios préstamos, puede pagar uno y no los otros.
- **RN-4.28** Un préstamo pasa a **pagado** cuando su saldo de capital y sus intereses llegan a cero.

### 4.7 Las dos vistas del préstamo ✅
| Vista | Quién la ve | Qué muestra |
|---|---|---|
| **Plan pactado** | Accionista y administrador | Cuotas acordadas al solicitar. Es lo que se le sugiere pagar en el módulo de pagos. |
| **Cuota para cerrar el año** | Administrador | `saldo pendiente ÷ meses restantes hasta diciembre, incluido el actual` |

**Ejemplo:** en octubre el saldo es 900.000 y faltan 3 meses (octubre, noviembre y diciembre). La cuota para cerrar el año es **300.000**.

---

## 5. Capitalizaciones ✅

- **RN-5.1** Una **capitalización** es un aporte extra que cuenta para la participación en utilidades.
- **RN-5.2** Hay dos tipos:
  - **Capitalización de enero:** es el **30% retenido** en la liquidación anterior (ver RN-8.3).
  - **Capitalización voluntaria:** la habilita el administrador en ventanas ⚙️ (ver RN-8.4).

---

## 6. Utilidades ✅

- **RN-6.1** Las utilidades vienen de los **intereses efectivamente pagados** en el mes, no de los intereses que se deben.
- **RN-6.2** `participación(mes) = (valor acumulado de acciones + acciones por préstamo + capitalizaciones del accionista) / (total del grupo)`. Se calcula con lo acumulado hasta ese mes inclusive.
- **RN-6.3** `utilidad(mes) = intereses pagados en el mes × participación(mes)`.
- **RN-6.4** Las multas **no** entran en el reparto.

**Ejemplo:** en abril se pagaron 100.000 de intereses y Ana tiene el 30% de participación. A Ana le corresponden **30.000** de utilidad.

---

## 7. Gastos ✅

- **RN-7.1** **Gasto anual:** en la liquidación se descuenta el **10% de las utilidades** ⚙️ de cada accionista.
- **RN-7.2** **Gastos puntuales:** el administrador registra un gasto (funeral, papelería, etc.) con su **concepto** y un **% de las utilidades**.
  - El monto se calcula sobre las utilidades totales **a esa fecha** y **queda fijo** para siempre.
  - Cada accionista aporta **el mismo %** de **sus** utilidades a esa fecha. El que más tiene, más aporta.
  - Se guarda la **foto** de cada accionista: sus utilidades a la fecha y lo que aportó.

**Ejemplo:** en abril las utilidades totales son 2.000.000 y el gasto es del 10%, así que queda fijo en **200.000**.
- Ana tiene 600.000 de utilidades y aporta **60.000**.
- Luis tiene 200.000 y aporta **20.000**.

En diciembre las utilidades llegan a 10.000.000, pero el gasto **sigue siendo 200.000**.

---

## 8. Liquidación anual ✅

### 8.1 Precondición (invariante)
- **RN-8.1** 🔒 **No se puede liquidar mientras algún accionista deba intereses.** El sistema bloquea la liquidación y muestra quién debe y cuánto. Si sus aportes no alcanzan, el accionista paga **de su bolsillo**.

### 8.2 Orden de cálculo por accionista
- **RN-8.2** El cálculo sigue este orden:

```
  Total aportes = acciones + acciones por préstamo + capitalizaciones + utilidades
1. (−) Gastos               = 10% × utilidades
2. (−) Retención            = 30% × (acciones + acciones por préstamo)    → capitalización de enero
3. (−) Capitalización voluntaria reservada (si la hay)                     → pasa al periodo siguiente
4. (−) Intereses adeudados  (deben quedar en 0)
5. (−) Capital adeudado − deuda que el accionista elige trasladar
       (si no alcanza, el capital restante también se traslada)            → "Deuda año anterior"
6. (=) Devolución en efectivo o transferencia
```

- **RN-8.3** La **retención del 30%** ⚙️ se calcula solo sobre acciones y acciones por préstamo (no sobre capitalizaciones). Pasa al periodo siguiente como **capitalización de enero**.
- **RN-8.4** **Capitalización voluntaria:**
  - El administrador la habilita ⚙️ en cualquier momento del año, por ejemplo a mitad de año.
  - El tope es lo que el accionista tiene en aportes **en ese momento**, menos el 30% generado hasta ese momento.
  - Una vez elegida queda **reservada**: no se puede usar para pagar deudas y pasa obligatoriamente al periodo siguiente.
  - Ese fondo financia los préstamos a plazo extendido (RN-4.3).
- **RN-8.5** **Deuda trasladada a voluntad:** solo **después de saldar los intereses**, el accionista puede elegir trasladar parte de su capital adeudado al periodo siguiente y recibir el resto de sus aportes.
- 🟡 **RN-8.6** **Si la reserva voluntaria deja sin cubrir los intereses de diciembre**, el accionista paga los intereses de su bolsillo y la reserva no se toca. *Validar con el gerente.*
  - **Caso para el gerente:** en junio Juan tiene 2.000.000 en aportes, la retención es de 600.000 y reserva 1.400.000. En agosto pide un préstamo grande y deja de pagar intereses. En diciembre debe 200.000 de intereses y no le alcanzan los aportes.
- **RN-8.7** La **devolución** se registra como un CE por accionista, con el concepto **"Devolución de utilidades"** y el medio de pago (efectivo o transferencia, y a qué cuenta).
- **RN-8.8** ✅ La **Deuda año anterior** se registra **automáticamente al liquidar**, como préstamo de enero del nuevo periodo. Sus condiciones:
  - **No exige acciones por préstamo** (RN-4.11).
  - **No pasa por votación.** La liquidación se comparte con todos los accionistas, así que ya la conocen.
  - Por lo demás funciona **como cualquier préstamo**: 2% mensual sobre el saldo pendiente y plazo hasta diciembre.

### 8.3 Ejemplo validado (Juan) ✅

| Concepto | Valor |
|---|---|
| Acciones + acciones por préstamo | 2.000.000 |
| Capitalizaciones del año | 500.000 |
| Utilidades | 1.000.000 |
| **Total aportes** | **3.500.000** |
| (−) Gastos (10% × 1.000.000) | −100.000 |
| (−) Retención (30% × 2.000.000), que pasa a capitalización de enero | −600.000 |
| (−) Capitalización voluntaria reservada | −300.000 |
| (−) Intereses adeudados | −50.000 |
| (−) Capital: debe 2.000.000, traslada 500.000, paga 1.500.000 | −1.500.000 |
| **Devolución** | **950.000** |

**Juan arranca el periodo siguiente con:**
- Capitalización de enero: 600.000.
- Capitalización voluntaria: 300.000.
- Deuda año anterior: 500.000.

> Este ejemplo **debe existir como test automático**.

---

## 9. Auditoría ✅

- **RN-9.1** Toda acción del administrador que cambie dinero, reglas o decisiones queda registrada. Esto incluye aprobaciones, rechazos, excepciones, cambios de parámetros, anulaciones, desbloqueos, gastos puntuales y liquidación.
- **RN-9.2** Cada registro guarda: **quién, cuándo, qué, valor anterior, valor nuevo y motivo**.
- **RN-9.3** El registro de auditoría es **solo de agregar**: nunca se edita ni se borra.

---

## 10. Parámetros configurables ⚙️

| Parámetro | Valor por defecto |
|---|---|
| Valores de acción permitidos | 10.000, 25.000, 50.000 |
| Mínimo y máximo de acciones por mes | 1 y 10 |
| Días de gracia para la multa | 10 |
| Multa por día | 500 |
| Tope de multa mensual | 15.000 |
| Multa por mes completo sin comprar | 15.000 |
| Tasa de interés mensual | 2% |
| Día límite para tasa completa en el primer mes | 15 |
| Día de corte del mes aplicado | 25 |
| Paso de acciones por préstamo | 500.000 |
| Monto mínimo de préstamo | sin mínimo |
| Máximo de préstamos activos | sin límite |
| Permitir plazo hasta diciembre del año siguiente | no |
| 4x1000 | 0,004 |
| Gasto anual sobre utilidades | 10% |
| Retención para el siguiente periodo | 30% |
| Zona horaria | America/Bogota |

---

## 11. Diferencias con el código actual

> Diagnóstico del 2026-10-13 sobre la rama `wip/respaldo-2026-10`. "Verificar" significa que hay que confirmarlo en el código antes de cambiarlo.

| # | Regla | Código actual | Acción |
|---|---|---|---|
| 1 | RN-4.10 acciones por préstamo | Redondeo hacia **abajo** (`src/lib/loans.ts`, `calcLoanShares`) | Cambiar a **TECHO** |
| 2 | RN-4.12 excepción con auditoría | No existe | Implementar |
| 3 | RN-4.1 mínimo de préstamo | 500.000 fijo (`schemas/loan.ts`) | Convertir en parámetro opcional |
| 4 | RN-4.2 préstamos activos | Máximo 2 | Parámetro opcional, sin límite por defecto |
| 5 | RN-4.3 plazo | 1 a 60 meses | Hasta diciembre, con opción de diciembre del año siguiente |
| 6 | RN-4.15 mes aplicado después del 25 | Verificar | Implementar si no existe |
| 6b | RN-4.14 acciones por préstamo pagadas por adelantado | Existe la opción (`toggle-upfront-shares`) | Verificar que bloquee el desembolso mientras el pago no esté aprobado |
| 7 | RN-4.16 base del 4x1000 | Sobre el neto | ✅ Coincide, se mantiene |
| 8 | RN-4.6 a 4.8 votación | Mayoría `⌊n/2⌋+1` | Verificar que n excluya al solicitante; agregar rechazo automático con observación |
| 9 | RN-4.17 desembolso atómico | Escrituras sueltas | Transacción o función SQL |
| 10 | RN-2.2 valor de acción por periodo | Bloqueo único | Reiniciar por periodo |
| 11 | RN-7.2 gastos puntuales | No existe | Implementar con foto por accionista |
| 12 | RN-8.x liquidación y cierre | Solo reporte en el cliente, sin cierre ni reinicio | Implementar en el servidor con el invariante RN-8.1 |
| 13 | RN-4.18 cálculo de intereses | Dos cálculos distintos (resumen y función SQL) | Unificar en una sola fuente |
| 14 | Zona horaria | Mezcla UTC y Bogotá | Todo en America/Bogota |
| 15 | RN-9 auditoría | No existe | Implementar |
| 16 | Seguridad | `loans_update_own_draft` permite editar la tasa; `system_settings` sin migración ni RLS | Corregir |

---

## 12. Pendientes

### 🟡 Para validar con el gerente
1. **RN-4.21:** interés de un préstamo desembolsado después del día 25.
2. **RN-8.6:** capitalización reservada frente a intereses impagos al cierre.

### ❓ Abiertas
Ninguna por ahora (cerradas el 2026-10-14).
