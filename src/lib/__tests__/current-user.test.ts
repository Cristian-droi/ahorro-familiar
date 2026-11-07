import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getCurrentUser } from '../current-user';

const user = { id: 'user-1' };
const lockError = new Error('Lock broken by another request with the \'steal\' option.');

function clientWith(getUser: ReturnType<typeof vi.fn>) {
  return { auth: { getUser } } as unknown as SupabaseClient;
}

describe('getCurrentUser', () => {
  it('returns the user on the first attempt', async () => {
    const getUser = vi.fn().mockResolvedValue({ data: { user } });

    await expect(getCurrentUser(clientWith(getUser), { delayMs: 0 })).resolves.toBe(user);
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('retries when another tab steals the auth lock', async () => {
    const getUser = vi
      .fn()
      .mockRejectedValueOnce(lockError)
      .mockRejectedValueOnce(lockError)
      .mockResolvedValue({ data: { user } });

    await expect(getCurrentUser(clientWith(getUser), { delayMs: 0 })).resolves.toBe(user);
    expect(getUser).toHaveBeenCalledTimes(3);
  });

  it('throws the last error when every attempt fails', async () => {
    const getUser = vi.fn().mockRejectedValue(lockError);

    await expect(getCurrentUser(clientWith(getUser), { delayMs: 0 })).rejects.toBe(lockError);
    expect(getUser).toHaveBeenCalledTimes(3);
  });

  it('returns null without retrying when there is no session', async () => {
    const getUser = vi.fn().mockResolvedValue({ data: { user: null } });

    await expect(getCurrentUser(clientWith(getUser), { delayMs: 0 })).resolves.toBeNull();
    expect(getUser).toHaveBeenCalledTimes(1);
  });
});
