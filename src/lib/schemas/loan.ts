import { z } from 'zod';
import type { DeductionDetail } from '@/types/entities';

export const createLoanSchema = z.object({
  requested_amount: z.number().int().positive().min(500_000),
  payment_plan_months: z.number().int().min(1).max(60),
  loan_shares_paid_upfront: z.boolean().default(false),
  deduct_obligations: z.boolean().default(false),
  deducted_capital_amount: z.number().nonnegative().default(0),
  deductions_detail: z.array(z.any()).default([]),
});

export const updatePaymentPlanSchema = z.object({
  months: z.number().int().min(1).max(60),
  capital_overrides: z.record(z.string(), z.number().nonnegative()),
});

export const reviewPlanSchema = z.object({
  action: z.enum(['approve', 'reject', 'request_revision']),
  rejection_reason: z.string().min(1).optional(),
  admin_notes: z.string().optional(),
});

export const disburseSchema = z.object({
  disbursement_proof_path: z.string().optional().nullable(),
  payment_method: z.enum(['transfer', 'cash']).default('transfer'),
}).refine((data) => {
  if (data.payment_method === 'transfer') {
    return !!data.disbursement_proof_path && data.disbursement_proof_path.trim().length > 0;
  }
  return true;
}, {
  message: 'Se requiere el comprobante de transferencia',
  path: ['disbursement_proof_path'],
});

export const voteSchema = z.object({
  vote: z.enum(['approved', 'rejected']),
  comment: z.string().max(500).optional(),
});

export const toggleUpfrontSharesSchema = z.object({
  loan_shares_paid_upfront: z.boolean(),
});

// Shape of each element stored in `loans.deductions_detail` (a `jsonb` column,
// typed as `Json`). Validated when read back so money fields are never trusted
// blindly.
export const deductionDetailSchema = z.object({
  concept: z.enum(['acciones', 'multa_acciones', 'pago_intereses', 'pago_capital']),
  target_month: z.string(),
  share_count: z.number().nullish(),
  unit_value: z.number().nullish(),
  amount: z.number(),
  loan_id: z.string().nullish(),
  loan_number: z.number().nullish(),
  disbursementNumber: z.string().nullish(),
}) satisfies z.ZodType<DeductionDetail>;

export const deductionsDetailSchema = z.array(deductionDetailSchema);
