import { describe, it, expect, vi } from 'vitest';
import { parseBankAccounts, pickDefaultBankAccountId } from '@/lib/schemas/bank-account';

const row = {
  id: 'a1',
  bank_name: 'Bancolombia',
  account_type: 'ahorros',
  holder_name: 'Titular',
  account_number: '123',
  qr_path: null,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('parseBankAccounts', () => {
  it('returns an empty list for null', () => {
    expect(parseBankAccounts(null)).toEqual([]);
  });

  it('parses valid rows of both account types', () => {
    const rows = [row, { ...row, id: 'a2', account_type: 'corriente' }];
    expect(parseBankAccounts(rows)).toEqual(rows);
  });

  it('drops a row with an account type outside the DB CHECK constraint', () => {
    expect(parseBankAccounts([{ ...row, account_type: 'nomina' }])).toEqual([]);
  });

  it('drops a row with a missing required field', () => {
    const { holder_name: _holder, ...broken } = row;
    expect(parseBankAccounts([broken])).toEqual([]);
  });

  it('keeps the valid rows of a mixed list and logs each dropped row id', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const valid2 = { ...row, id: 'a3', account_type: 'corriente' };
    const result = parseBankAccounts([row, { ...row, id: 'bad1', account_type: 'nomina' }, valid2, null]);

    expect(result).toEqual([row, valid2]);
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(errorSpy.mock.calls[0][0]).toContain('bad1');
    expect(errorSpy.mock.calls[1][0]).toContain('unknown');
    errorSpy.mockRestore();
  });
});

describe('pickDefaultBankAccountId', () => {
  it('returns null when there are no accounts', () => {
    expect(pickDefaultBankAccountId([])).toBeNull();
  });

  it('picks the first account shown, never a dropped invalid row', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const shown = parseBankAccounts([{ ...row, id: 'bad1', account_type: 'nomina' }, { ...row, id: 'a2' }]);

    expect(pickDefaultBankAccountId(shown)).toBe('a2');
    errorSpy.mockRestore();
  });
});
