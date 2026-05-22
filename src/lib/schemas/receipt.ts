import { z } from 'zod';

// Payload para crear o reenviar un recibo de compra.
//
// Aceptamos dos tipos de item desde la UI:
//   - 'acciones'       : target_month + share_count
//   - 'capitalizacion' : target_month + amount (monto libre)
//
// Los demás conceptos del enum existen en DB pero el endpoint los rechaza
// hasta que se implemente el módulo correspondiente.
//
// target_month es un string ISO de primer día de mes ('YYYY-MM-01'). La
// validación fina (rango de año, ventana abierta, etc.) la hace el trigger
// en DB; acá solo validamos forma.

const targetMonthString = z
  .string()
  .regex(/^\d{4}-\d{2}-01$/, 'Mes inválido (debe ser el día 1 del mes)');

export const accionesItemInput = z.object({
  concept: z.literal('acciones'),
  target_month: targetMonthString,
  share_count: z
    .number()
    .int()
    .min(1, 'Debe comprar al menos 1 acción')
    .max(10, 'No puede comprar más de 10 acciones por línea'),
});
export type AccionesItemInput = z.infer<typeof accionesItemInput>;

export const capitalizacionItemInput = z.object({
  concept: z.literal('capitalizacion'),
  target_month: targetMonthString,
  amount: z
    .number()
    .positive('El monto debe ser mayor a cero')
    .max(
      999_999_999,
      'El monto de capitalización es demasiado grande',
    ),
});
export type CapitalizacionItemInput = z.infer<typeof capitalizacionItemInput>;

// Pago de intereses / abono a capital de un préstamo activo del accionista.
// loan_id es obligatorio; el trigger valida que pertenezca al mismo user.
export const pagoInteresesItemInput = z.object({
  concept: z.literal('pago_intereses'),
  target_month: targetMonthString,
  amount: z
    .number()
    .positive('El monto debe ser mayor a cero')
    .max(999_999_999, 'Monto demasiado grande'),
  loan_id: z.string().uuid('loan_id inválido'),
});
export type PagoInteresesItemInput = z.infer<typeof pagoInteresesItemInput>;

export const pagoCapitalItemInput = z.object({
  concept: z.literal('pago_capital'),
  target_month: targetMonthString,
  amount: z
    .number()
    .positive('El monto debe ser mayor a cero')
    .max(999_999_999, 'Monto demasiado grande'),
  loan_id: z.string().uuid('loan_id inválido'),
});
export type PagoCapitalItemInput = z.infer<typeof pagoCapitalItemInput>;

// Pago upfront de las acciones por préstamo. La UI envía solo loan_id;
// el backend resuelve loan_shares_count, unit_value y amount desde la fila
// del préstamo (no confiamos en lo que mande el cliente para esto).
export const accionesPrestamoItemInput = z.object({
  concept: z.literal('acciones_prestamo'),
  target_month: targetMonthString,
  loan_id: z.string().uuid('loan_id inválido'),
});
export type AccionesPrestamoItemInput = z.infer<typeof accionesPrestamoItemInput>;

// Discriminado por `concept` para que el consumidor pueda hacer narrowing.
export const purchaseItemInput = z.discriminatedUnion('concept', [
  accionesItemInput,
  capitalizacionItemInput,
  pagoInteresesItemInput,
  pagoCapitalItemInput,
  accionesPrestamoItemInput,
]);
export type PurchaseItemInput = z.infer<typeof purchaseItemInput>;

export const createReceiptPayload = z
  .object({
    items: z
      .array(purchaseItemInput)
      .min(1, 'Agrega al menos una compra')
      .max(24, 'Demasiadas líneas en un solo recibo'),
    payment_method: z.enum(['transfer', 'cash']).default('transfer'),
    bank_account_id: z.string().uuid('Cuenta de banco inválida').nullable().optional(),
    payment_proof_path: z
      .string()
      .max(512)
      .nullable()
      .optional(),
  })
  .superRefine((val, ctx) => {
    // Una sola capitalización por recibo. Ver spec del módulo.
    const capCount = val.items.filter(
      (i) => i.concept === 'capitalizacion',
    ).length;
    if (capCount > 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'Solo se permite una línea de capitalización por recibo',
        path: ['items'],
      });
    }

    if (val.payment_method === 'transfer') {
      if (!val.bank_account_id) {
        ctx.addIssue({
          code: 'custom',
          message: 'Debe seleccionar una cuenta bancaria para pagos por transferencia',
          path: ['bank_account_id'],
        });
      }
      if (!val.payment_proof_path || val.payment_proof_path.trim() === '') {
        ctx.addIssue({
          code: 'custom',
          message: 'El comprobante es obligatorio para pagos por transferencia',
          path: ['payment_proof_path'],
        });
      }
    }
  });

export type CreateReceiptPayload = z.infer<typeof createReceiptPayload>;

// Para reenviar un recibo rechazado usamos el mismo shape del body; el id
// viene del path param.
export const resubmitReceiptPayload = createReceiptPayload;

export const rejectReceiptPayload = z.object({
  reason: z.enum(['amount_mismatch', 'payment_not_received']),
  note: z
    .string()
    .trim()
    .max(500, 'La nota es demasiado larga')
    .optional()
    .nullable(),
});

export type RejectReceiptPayload = z.infer<typeof rejectReceiptPayload>;
