import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { Loan, LoanVote, LoanWithDetails } from '@/types/entities';
import {
  countAdminPendingLoans,
  getMyPendingLoanSharePurchases,
  countMyPendingLoanSharePurchases,
  getMyActiveLoansDebt,
  countLoansReadyForDisbursementForUser,
  countLoansActiveUnseenForUser,
  countLoansRequiringActionForUser,
  countLoansAwaitingMyVote,
  getLoan,
  getLoansForUser,
  getAllLoans,
  getLoanWithDetails,
  getLoansForVoting,
  getActiveLoansForUser,
  getCashBalance,
  getMyVotingHistory,
  getLoansWithDisbursement,
  getLibroAccionistaData,
  type AdminPendingLoanCounts,
  type PendingLoanSharePurchase,
  type ActiveLoanDebt,
  type LoanWithBorrowerName,
  type LoanWithBorrower,
  type VoteHistoryItem,
  type LibroAccionistaEntry,
  type LibroAccionistaPayment,
  type LibroAccionistaLoan,
} from '@/lib/data/loans';

type SB = SupabaseClient<Database>;

export class LoanRepository {
  constructor(private readonly supabase: SB) {}

  async countAdminPendingLoans(): Promise<AdminPendingLoanCounts> {
    return countAdminPendingLoans(this.supabase);
  }



  async getMyPendingLoanSharePurchases(): Promise<PendingLoanSharePurchase[]> {
    return getMyPendingLoanSharePurchases(this.supabase);
  }

  async countMyPendingLoanSharePurchases(): Promise<number> {
    return countMyPendingLoanSharePurchases(this.supabase);
  }

  async getMyActiveLoansDebt(): Promise<ActiveLoanDebt[]> {
    return getMyActiveLoansDebt(this.supabase);
  }

  async countLoansReadyForDisbursementForUser(userId: string): Promise<number> {
    return countLoansReadyForDisbursementForUser(this.supabase, userId);
  }

  async countLoansActiveUnseenForUser(userId: string): Promise<number> {
    return countLoansActiveUnseenForUser(this.supabase, userId);
  }

  async countLoansRequiringActionForUser(userId: string): Promise<number> {
    return countLoansRequiringActionForUser(this.supabase, userId);
  }

  async countLoansAwaitingMyVote(voterId: string): Promise<number> {
    return countLoansAwaitingMyVote(this.supabase, voterId);
  }

  async getLoan(id: string): Promise<Loan | null> {
    return getLoan(this.supabase, id);
  }

  async getLoansForUser(userId: string): Promise<Loan[]> {
    return getLoansForUser(this.supabase, userId);
  }

  async getAllLoans(): Promise<LoanWithBorrower[]> {
    return getAllLoans(this.supabase);
  }

  async getLoanWithDetails(id: string): Promise<LoanWithDetails | null> {
    return getLoanWithDetails(this.supabase, id);
  }

  async getLoansForVoting(voterId: string) {
    return getLoansForVoting(this.supabase, voterId);
  }

  async getActiveLoansForUser(userId: string): Promise<Loan[]> {
    return getActiveLoansForUser(this.supabase, userId);
  }

  async getCashBalance(): Promise<number> {
    return getCashBalance(this.supabase);
  }

  async getMyVotingHistory(voterId: string): Promise<VoteHistoryItem[]> {
    return getMyVotingHistory(this.supabase, voterId);
  }

  async getLoansWithDisbursement(): Promise<LoanWithBorrowerName[]> {
    return getLoansWithDisbursement(this.supabase);
  }

  async getLibroAccionistaData(userId?: string): Promise<LibroAccionistaEntry[]> {
    return getLibroAccionistaData(this.supabase, userId);
  }

  async countActiveShareholders(): Promise<number> {
    const { data, error } = await this.supabase.rpc('count_active_shareholders');
    if (error) throw error;
    return Number(data ?? 0);
  }

  async getVoteSummaries(loanIds: string[]): Promise<Map<string, { approved: number; rejected: number }>> {
    const map = new Map<string, { approved: number; rejected: number }>();
    if (loanIds.length === 0) return map;

    for (const id of loanIds) map.set(id, { approved: 0, rejected: 0 });

    // RN-4.9b: only totals. RLS hides other people's rows in loan_votes.
    const { data: totals, error } = await this.supabase.rpc('get_loan_vote_totals', {
      p_loan_ids: loanIds,
    });

    if (error) throw error;

    for (const t of totals ?? []) {
      if (map.has(t.loan_id)) {
        map.set(t.loan_id, { approved: Number(t.approved), rejected: Number(t.rejected) });
      }
    }
    return map;
  }
}
