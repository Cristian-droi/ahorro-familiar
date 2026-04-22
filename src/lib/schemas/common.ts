import { z } from 'zod';

// Primitivos compartidos por todos los esquemas del dominio.
// Aceptan strings "sucios" desde el form (con espacios, comas, puntos)
// y los normalizan al formato canónico que guardamos en DB.

export const identityDocument = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .pipe(
    z
      .string()
      .min(7, 'El documento debe tener más de 6 dígitos')
      .max(15, 'El documento es demasiado largo'),
  );

export const phone = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .pipe(
    z
      .string()
      .length(10, 'Un celular válido debe tener 10 dígitos'),
  );

export const email = z
  .string()
  .trim()
  .min(1, 'El correo es obligatorio')
  .email('Ingresa un correo electrónico válido')
  .transform((v) => v.toLowerCase());

export const nonEmptyName = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} es obligatorio`)
    .max(100, `${label} es demasiado largo`);

// Monto en pesos colombianos. El form lo manda como "2.500.000" o "2500000".
export const money = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .pipe(
    z
      .string()
      .min(1, 'El monto es obligatorio')
      .transform((v) => Number.parseInt(v, 10))
      .pipe(z.number().int().nonnegative()),
  );

export const uuid = z.string().uuid('ID inválido');
