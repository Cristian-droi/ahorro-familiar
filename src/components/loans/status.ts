// Loan status labels and badge tones for the UI (moved out of src/lib/loans.ts).

export const LOAN_STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador',
  pending_review: 'En revisión',
  pending_shareholder_vote: 'En votación',
  pending_disbursement: 'Listo para desembolso',
  active: 'Activo',
  paid: 'Pagado',
  rejected_by_admin: 'Rechazado (admin)',
  rejected_by_shareholders: 'Rechazado (votación)',
  // RN-4.5b: more than 15 days from submission without a disbursement.
  expired: 'Anulada por vencimiento',
};

export const LOAN_STATUS_TONE: Record<string, string> = {
  draft: 'neutral',
  pending_review: 'warn',
  pending_shareholder_vote: 'info',
  pending_disbursement: 'brand',
  active: 'success',
  paid: 'success',
  rejected_by_admin: 'danger',
  rejected_by_shareholders: 'danger',
  expired: 'neutral',
};
