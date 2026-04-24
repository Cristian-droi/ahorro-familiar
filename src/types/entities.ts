import type { UserRole } from '@/lib/schemas/profile';

export type { UserRole };

export type RequestStatus = 'pending' | 'approved' | 'rejected';

export interface MembershipRequest {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  address: string;
  identity_document: string;
  monthly_income: number;
  status: RequestStatus;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  first_name: string;
  last_name: string;
  identity_document: string;
  phone: string | null;
  address: string | null;
  monthly_income: number | null;
  role: UserRole;
  selected_share_value: number | null;
  share_value_change_allowed: boolean;
  created_at: string;
  updated_at: string;
}

export type ReceiptStatus = 'pending' | 'approved' | 'rejected';

export type ReceiptConcept =
  | 'acciones'
  | 'acciones_prestamo'
  | 'pago_capital'
  | 'pago_intereses'
  | 'capitalizacion'
  | 'multa_acciones'
  | 'otros';

export type ReceiptRejectionReason = 'amount_mismatch' | 'payment_not_received';

export interface ReceiptItem {
  id: string;
  receipt_id: string;
  concept: ReceiptConcept;
  target_month: string; // ISO date (primer día del mes)
  share_count: number | null;
  unit_value: number | null;
  amount: number;
  auto_generated: boolean;
  created_at: string;
}

export interface Receipt {
  id: string;
  receipt_number: string | null;
  user_id: string;
  status: ReceiptStatus;
  submitted_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  rejection_reason: ReceiptRejectionReason | null;
  rejection_note: string | null;
  payment_proof_path: string | null;
  total_amount: number;
  created_at: string;
  updated_at: string;
}

export interface ReceiptWithItems extends Receipt {
  items: ReceiptItem[];
}

// ============================================================
// Loans
// ============================================================

export type LoanStatus =
  | 'draft'
  | 'pending_review'
  | 'pending_shareholder_vote'
  | 'pending_disbursement'
  | 'active'
  | 'paid'
  | 'rejected_by_admin'
  | 'rejected_by_shareholders';

export type LoanVoteValue = 'approved' | 'rejected';

export type PlanReviewStatus = 'approved' | 'rejected';

export interface Loan {
  id: string;
  user_id: string;
  requested_amount: number;
  interest_rate: number;
  loan_shares_count: number;
  loan_shares_amount: number;
  loan_shares_paid_upfront: boolean;
  four_per_thousand: number;
  disbursed_amount: number | null;
  disbursed_at: string | null;
  outstanding_balance: number;
  last_interest_payment_date: string | null;
  status: LoanStatus;
  payment_plan_months: number | null;
  plan_status: PlanReviewStatus | null;
  plan_rejection_reason: string | null;
  admin_notes: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface LoanPaymentPlanItem {
  id: string;
  loan_id: string;
  month_number: number;
  due_date: string;
  capital_amount: number;
  estimated_interest: number;
  estimated_balance_after: number;
  created_at: string;
}

export interface LoanVote {
  id: string;
  loan_id: string;
  voter_id: string;
  vote: LoanVoteValue;
  comment: string | null;
  voted_at: string;
  created_at: string;
}

export interface LoanWithDetails extends Loan {
  payment_plan: LoanPaymentPlanItem[];
  votes: LoanVote[];
  borrower: Pick<Profile, 'id' | 'first_name' | 'last_name' | 'identity_document' | 'selected_share_value'> | null;
  total_active_shareholders: number;
  approved_votes: number;
  rejected_votes: number;
  has_upfront_shares_receipt: boolean;
}
