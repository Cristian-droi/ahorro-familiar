import { z } from 'zod';

export const createLoanSchema = z.object({
  requested_amount: z.number().int().positive().min(500_000),
  payment_plan_months: z.number().int().min(1).max(60),
  loan_shares_paid_upfront: z.boolean().default(false),
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
  disbursement_proof_path: z.string().min(1),
});

export const voteSchema = z.object({
  vote: z.enum(['approved', 'rejected']),
  comment: z.string().max(500).optional(),
});

export const toggleUpfrontSharesSchema = z.object({
  loan_shares_paid_upfront: z.boolean(),
});
