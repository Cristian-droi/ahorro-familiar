import { z } from 'zod';
import { uuid } from './common';

// Payload para cambiar el permiso de edición del valor de acción.
//
// El admin puede:
//   - Permitir / revocar para un usuario específico (userId).
//   - Permitir / revocar para todos los accionistas (scope = 'all').
//
// Siempre se envía `allow` explícito para que el admin sepa exactamente lo
// que está haciendo (sin "toggles" implícitos en el servidor).

export const shareValueLockPayload = z.discriminatedUnion('scope', [
  z.object({
    scope: z.literal('user'),
    userId: uuid,
    allow: z.boolean(),
  }),
  z.object({
    scope: z.literal('all'),
    allow: z.boolean(),
  }),
]);

export type ShareValueLockPayload = z.infer<typeof shareValueLockPayload>;
