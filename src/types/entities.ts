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
