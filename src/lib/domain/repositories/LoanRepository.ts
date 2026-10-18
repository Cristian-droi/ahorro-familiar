import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { Loan, LoanVote, LoanWithDetails } from '@/types/entities';
import {
  countAdminPendingLoans,
  getMyUtilitiesByYear,
  getUserUtilitiesByYear,
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
  type MonthlyUtility,
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

  async getMyUtilitiesByYear(year: number): Promise<MonthlyUtility[]> {
    return getMyUtilitiesByYear(this.supabase, year);
  }

  async getUserUtilitiesByYear(userId: string, year: number): Promise<MonthlyUtility[]> {
    return getUserUtilitiesByYear(this.supabase, userId, year);
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

    const { data: votes, error } = await this.supabase
      .from('loan_votes')
      .select('loan_id, vote')
      .in('loan_id', loanIds);
    
    if (error) throw error;

    for (const v of votes ?? []) {
      const s = map.get(v.loan_id);
      if (!s) continue;
      if (v.vote === 'approved') s.approved += 1;
      else if (v.vote === 'rejected') s.rejected += 1;
    }
    return map;
  }
}
