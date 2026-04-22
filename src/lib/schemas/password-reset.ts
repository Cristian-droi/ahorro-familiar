import { z } from 'zod';
import { identityDocument } from './common';

// Input del formulario público de "olvidé mi contraseña".
// Pedimos solo el documento (lo que el usuario memoriza). El correo real
// para enviar el link lo resolvemos en el servidor.
export const passwordResetInput = z.object({
  identityDocument,
});

export type PasswordResetInput = z.input<typeof passwordResetInput>;
export type PasswordResetParsed = z.output<typeof passwordResetInput>;
