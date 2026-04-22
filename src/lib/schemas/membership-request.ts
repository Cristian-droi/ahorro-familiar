import { z } from 'zod';
import {
  email,
  identityDocument,
  money,
  nonEmptyName,
  phone,
  uuid,
} from './common';

// Input del formulario público de solicitud de ingreso.
// Se usa en cliente (validación + submit) y en servidor (revalidación).
export const membershipRequestInput = z.object({
  firstName: nonEmptyName('Los nombres'),
  lastName: nonEmptyName('Los apellidos'),
  phone,
  email,
  address: z.string().trim().min(1, 'La dirección es obligatoria').max(200),
  identityDocument,
  monthlyIncome: money,
});

export type MembershipRequestInput = z.input<typeof membershipRequestInput>;
export type MembershipRequestParsed = z.output<typeof membershipRequestInput>;

// Mapeo del input parseado al shape de la tabla (snake_case).
export function toMembershipRequestRow(data: MembershipRequestParsed) {
  return {
    first_name: data.firstName,
    last_name: data.lastName,
    phone: data.phone,
    email: data.email,
    address: data.address,
    identity_document: data.identityDocument,
    monthly_income: data.monthlyIncome,
  };
}

// Payloads de las acciones admin sobre una solicitud.
export const approveRequestPayload = z.object({
  id: uuid,
});
export type ApproveRequestPayload = z.infer<typeof approveRequestPayload>;

export const rejectRequestPayload = z.object({
  id: uuid,
  reason: z
    .string()
    .trim()
    .min(5, 'El motivo debe tener al menos 5 caracteres')
    .max(500, 'El motivo es demasiado largo'),
});
export type RejectRequestPayload = z.infer<typeof rejectRequestPayload>;
