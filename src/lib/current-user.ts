import type { SupabaseClient, User } from '@supabase/supabase-js';

const ATTEMPTS = 3;

// With two tabs open, one can steal the browser auth lock from the other, and
// getUser() throws instead of returning an error. That failure is temporary, so it
// is retried. Throws the last error when every attempt fails.
export async function getCurrentUser(
  client: Pick<SupabaseClient, 'auth'>,
  { delayMs = 500 }: { delayMs?: number } = {},
): Promise<User | null> {
  for (let attempt = 1; ; attempt++) {
    try {
      const { data } = await client.auth.getUser();
      return data.user;
    } catch (err) {
      if (attempt === ATTEMPTS) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
