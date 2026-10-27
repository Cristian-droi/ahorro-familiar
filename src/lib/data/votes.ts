import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

type SB = SupabaseClient<Database>;
type Role = Database['public']['Enums']['user_role'];

// Ids of every active shareholder (role 'accionista'). Needs a client that
// can read all profiles (admin client), because RLS only shows your own.
// Feed the result to `votantesHabilitados` in the voting domain.
export async function getShareholderIds(supabase: SB): Promise<string[]> {
  const { data, error } = await supabase.from('profiles').select('id').eq('role', 'accionista');
  if (error) throw error;
  return (data ?? []).map((p) => p.id);
}

// RN-4.6: n = active shareholders except the applicant. Pages only have the
// total from `count_active_shareholders()`, which includes the applicant
// when the applicant is a shareholder. An unknown role (RLS hides another
// member's profile) counts as a shareholder, since shareholders request loans.
export function eligibleVoterCount(params: {
  totalShareholders: number;
  applicantRole: Role | null | undefined;
}): number {
  const applicantIsShareholder = params.applicantRole !== 'admin';
  return Math.max(params.totalShareholders - (applicantIsShareholder ? 1 : 0), 0);
}
