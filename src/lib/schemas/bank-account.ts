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

// Drops (and logs) any row that violates the expected shape, so one bad row
// does not hide the valid accounts from the list.
export function parseBankAccounts(rows: unknown[] | null): BankAccount[] {
  const accounts: BankAccount[] = [];
  for (const row of rows ?? []) {
    const result = bankAccountRow.safeParse(row);
    if (result.success) {
      accounts.push(result.data);
    } else {
      const id = (row as { id?: unknown } | null)?.id ?? 'unknown';
      console.error(`Invalid bank_accounts row dropped (id: ${String(id)})`, result.error.issues);
    }
  }
  return accounts;
}
