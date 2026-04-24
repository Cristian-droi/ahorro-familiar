import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { Loan, LoanVote, LoanWithDetails } from '@/types/entities';

type SB = SupabaseClient<Database>;

export async function getLoan(supabase: SB, id: string): Promise<Loan | null> {
  const { data, error } = await supabase
    .from('loans')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as Loan | null;
}

export async function getLoansForUser(supabase: SB, userId: string): Promise<Loan[]> {
  const { data, error } = await supabase
    .from('loans')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Loan[];
}

export async function getAllLoans(supabase: SB): Promise<Loan[]> {
  const { data, error } = await supabase
    .from('loans')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Loan[];
}

export async function getLoanWithDetails(
  supabase: SB,
  id: string,
): Promise<LoanWithDetails | null> {
  const [loanRes, planRes, votesRes, totalRes] = await Promise.all([
    supabase
      .from('loans')
      .select(`*, borrower:profiles!loans_user_id_fkey(id,first_name,last_name,identity_document,selected_share_value)`)
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('loan_payment_plan_items')
      .select('*')
      .eq('loan_id', id)
      .order('month_number'),
    supabase
      .from('loan_votes')
      .select(`*, voter:profiles!loan_votes_voter_id_fkey(id,first_name,last_name)`)
      .eq('loan_id', id),
    supabase.rpc('count_active_shareholders'),
  ]);

  if (loanRes.error) throw loanRes.error;
  if (!loanRes.data) return null;

  const votes = (votesRes.data ?? []) as Array<Record<string, unknown>>;
  const approvedVotes = votes.filter((v) => v.vote === 'approved').length;
  const rejectedVotes = votes.filter((v) => v.vote === 'rejected').length;

  // Verificar si hay un recibo aprobado de acciones_prestamo para este préstamo
  const { data: upfrontItems } = await supabase
    .from('receipt_items')
    .select('id, receipts!inner(status)')
    .eq('concept', 'acciones_prestamo')
    .eq('loan_id', id);

  const hasUpfront = (upfrontItems ?? []).some(
    (item) => (item as Record<string, unknown>).receipts !== null,
  );

  const loan = loanRes.data as Record<string, unknown>;
  const borrower = loan.borrower as LoanWithDetails['borrower'];

  return {
    ...(loan as unknown as Loan),
    borrower: borrower ?? null,
    payment_plan: (planRes.data ?? []) as LoanWithDetails['payment_plan'],
    votes: votes as unknown as LoanWithDetails['votes'],
    total_active_shareholders: Number(totalRes.data ?? 0),
    approved_votes: approvedVotes,
    rejected_votes: rejectedVotes,
    has_upfront_shares_receipt: hasUpfront,
  };
}

export async function getLoansForVoting(
  supabase: SB,
  voterId: string,
): Promise<Array<Loan & { has_voted: boolean; borrower_name: string }>> {
  const { data: loans, error } = await supabase
    .from('loans')
    .select(`*, borrower:profiles!loans_user_id_fkey(first_name,last_name)`)
    .eq('status', 'pending_shareholder_vote')
    .order('created_at', { ascending: false });

  if (error) throw error;
  if (!loans || loans.length === 0) return [];

  const loanIds = loans.map((l) => l.id);
  const { data: myVotes } = await supabase
    .from('loan_votes')
    .select('loan_id')
    .eq('voter_id', voterId)
    .in('loan_id', loanIds);

  const votedSet = new Set((myVotes ?? []).map((v) => v.loan_id));

  return loans.map((l) => {
    const b = l.borrower as Record<string, string> | null;
    return {
      ...(l as unknown as Loan),
      has_voted: votedSet.has(l.id),
      borrower_name: b ? `${b.first_name} ${b.last_name}` : 'Accionista',
    };
  });
}

export async function getActiveLoansForUser(supabase: SB, userId: string): Promise<Loan[]> {
  const { data, error } = await supabase
    .from('loans')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active');
  if (error) throw error;
  return (data ?? []) as Loan[];
}

export async function getCashBalance(supabase: SB): Promise<number> {
  const { data, error } = await supabase.rpc('get_cash_balance');
  if (error) throw error;
  return Number(data ?? 0);
}

export type VoteHistoryItem = {
  loan: Loan & { borrower_name: string };
  vote: LoanVote;
};

export async function getMyVotingHistory(
  supabase: SB,
  voterId: string,
): Promise<VoteHistoryItem[]> {
  const { data, error } = await supabase
    .from('loan_votes')
    .select(`
      *,
      loan:loans(
        id, status, requested_amount, payment_plan_months, user_id, created_at,
        borrower:profiles!loans_user_id_fkey(first_name, last_name)
      )
    `)
    .eq('voter_id', voterId)
    .order('voted_at', { ascending: false });

  if (error) throw error;
  if (!data || data.length === 0) return [];

  return data.map((row) => {
    const loan = row.loan as Record<string, unknown> | null;
    const borrower = loan?.borrower as Record<string, string> | null;
    return {
      loan: {
        ...(loan as unknown as Loan),
        borrower_name: borrower ? `${borrower.first_name} ${borrower.last_name}` : 'Accionista',
      },
      vote: row as unknown as LoanVote,
    };
  });
}

export async function getLoansWithDisbursement(supabase: SB): Promise<Loan[]> {
  const { data, error } = await supabase
    .from('loans')
    .select(`*, borrower:profiles!loans_user_id_fkey(first_name, last_name)`)
    .in('status', ['active', 'paid'])
    .not('disbursement_number', 'is', null)
    .order('disbursed_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Loan[];
}
