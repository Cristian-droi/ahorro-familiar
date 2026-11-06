// RN-4.5b: a loan request expires when more than 15 days pass from its
// submission without a disbursement. One helper for every route that acts on
// a pending request (review, vote, disbursement).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { hoyBogota } from '@/shared/domain/fechas';
import { DIAS_DE_VIGENCIA_DE_SOLICITUD, solicitudVencida } from '@/modules/prestamos/domain/vigencia';

export const EXPIRED_REQUEST_MESSAGE =
  'La solicitud venció: pasaron más de 15 días sin desembolso. Vuelve a hacerla.';

// Submitted and not yet disbursed.
const EXPIRABLE_STATUSES = new Set(['pending_review', 'pending_shareholder_vote', 'pending_disbursement']);

type LoanStatus = Database['public']['Enums']['loan_status'];

export function isLoanRequestExpired(
  loan: { status: string; submitted_at: string | null },
  now: Date,
): boolean {
  if (!EXPIRABLE_STATUSES.has(loan.status) || !loan.submitted_at) return false;
  const enviada = new Date(loan.submitted_at);
  if (Number.isNaN(enviada.getTime())) return false;
  return solicitudVencida({
    enviadaEl: hoyBogota(enviada),
    hoy: hoyBogota(now),
    diasDeVigencia: DIAS_DE_VIGENCIA_DE_SOLICITUD,
  });
}

// When the request is expired, marks it 'expired' (only if its status did not
// change meanwhile) and returns true so the caller answers 409 with
// EXPIRED_REQUEST_MESSAGE without doing the action. A failed update still
// returns true: the action must not run on an expired request.
export async function expireLoanRequestIfDue(
  admin: SupabaseClient<Database>,
  loan: { id: string; status: LoanStatus | string; submitted_at: string | null },
  now: Date = new Date(),
): Promise<boolean> {
  if (!isLoanRequestExpired(loan, now)) return false;
  const { data, error } = await admin
    .from('loans')
    .update({ status: 'expired', updated_at: now.toISOString() })
    .eq('id', loan.id)
    .eq('status', loan.status as LoanStatus)
    .select('id');
  if (error) {
    console.error('expireLoanRequestIfDue: no se pudo marcar la solicitud como vencida', error);
    return true;
  }
  // No row matched: another action changed the status meanwhile, so this
  // request was not expired here and the caller keeps its own status checks.
  return (data ?? []).length > 0;
}
