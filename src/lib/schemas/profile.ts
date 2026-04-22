import { z } from 'zod';
import { email, nonEmptyName, phone, uuid } from './common';

export const userRole = z.enum(['admin', 'accionista']);
export type UserRole = z.infer<typeof userRole>;

export const bankAccountType = z.enum(['ahorros', 'corriente']);
export type BankAccountType = z.infer<typeof bankAccountType>;

// Shape completo de una fila de `profiles` tal como la expone Supabase.
export const profile = z.object({
  id: uuid,
  first_name: z.string(),
  last_name: z.string(),
  identity_document: z.string(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  monthly_income: z.number().nullable(),
  role: userRole,
  selected_share_value: z.number().nullable(),
  share_value_change_allowed: z.boolean(),
  bank_name: z.string().nullable(),
  bank_account_number: z.string().nullable(),
  bank_account_type: bankAccountType.nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Profile = z.infer<typeof profile>;

// Campos que un accionista puede actualizar de su propio perfil.
// El rol y el documento NO son editables por el usuario (RLS también lo impide).
export const updateOwnProfileInput = z.object({
  first_name: nonEmptyName('Los nombres').optional(),
  last_name: z.string().trim().max(100).optional(),
  phone: phone.optional(),
  address: z.string().trim().max(200).optional(),
});
export type UpdateOwnProfileInput = z.infer<typeof updateOwnProfileInput>;

// Solicitud de cambio de correo REAL (el de contacto, no el de login).
// Se envía un enlace de verificación al correo nuevo; el cambio se aplica
// solo cuando el usuario hace clic en el enlace.
export const requestEmailChangeInput = z.object({
  new_email: email,
});
export type RequestEmailChangeInput = z.infer<typeof requestEmailChangeInput>;
