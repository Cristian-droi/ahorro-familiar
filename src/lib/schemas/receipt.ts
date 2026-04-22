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

// Discriminado por `concept` para que el consumidor pueda hacer narrowing.
export const purchaseItemInput = z.discriminatedUnion('concept', [
  accionesItemInput,
  capitalizacionItemInput,
]);
export type PurchaseItemInput = z.infer<typeof purchaseItemInput>;

export const createReceiptPayload = z
  .object({
    items: z
      .array(purchaseItemInput)
      .min(1, 'Agrega al menos una compra')
      .max(24, 'Demasiadas líneas en un solo recibo'),
    payment_proof_path: z
      .string()
      .min(1, 'El comprobante es obligatorio')
      .max(512),
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
