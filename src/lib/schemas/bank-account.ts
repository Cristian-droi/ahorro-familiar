import { z } from 'zod';
import { bankAccountType } from './profile';
import type { BankAccount } from '@/types/entities';

// DB row of `bank_accounts`. The column `account_type` is `text` with a CHECK
// constraint, so the generated types only say `string`. We validate it here,
// at the boundary, instead of casting.
export const bankAccountRow = z.object({
  id: z.string(),
  bank_name: z.string(),
  account_type: bankAccountType,
  holder_name: z.string(),
  account_number: z.string(),
  qr_path: z.string().nullable(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
}) satisfies z.ZodType<BankAccount>;

// Throws if any row violates the expected shape (e.g. an unknown account type).
export function parseBankAccounts(rows: unknown[] | null): BankAccount[] {
  return z.array(bankAccountRow).parse(rows ?? []);
}
