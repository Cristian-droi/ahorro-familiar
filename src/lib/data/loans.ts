import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { Loan, LoanVote, LoanWithDetails, Profile } from '@/types/entities';
import { eligibleVoterCount } from './votes';
import { calcAccruedInterest, summarizeActiveLoanDebt, type LoanInterestItem } from '@/lib/loans';
import { ajustesDelPrestamo, getAjustesDePrestamo } from '@/lib/loan-settings';
import type { FechaISO } from '@/shared/domain/fechas';

type SB = SupabaseClient<Database>;

// Conteo de préstamos que requieren acción del admin: los que están en
// revisión inicial y los aprobados que esperan el desembolso. Se usa para
// el badge del item "Préstamos" del nav admin y para el dropdown de
// notificaciones del header.
export type AdminPendingLoanCounts = {
  pendingReview: number;
  pendingDisbursement: number;
  total: number;
};

export async function countAdminPendingLoans(
  supabase: SB,
): Promise<AdminPendingLoanCounts> {
  const [reviewRes, disbRes] = await Promise.all([
    supabase
      .from('loans')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending_review'),
    supabase
      .from('loans')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending_disbursement'),
  ]);

  if (reviewRes.error) throw reviewRes.error;
  if (disbRes.error) throw disbRes.error;

  const pendingReview = reviewRes.count ?? 0;
  const pendingDisbursement = disbRes.count ?? 0;
  return {
    pendingReview,
    pendingDisbursement,
    total: pendingReview + pendingDisbursement,
  };
}

// Monthly profits of a shareholder (RN-6), as served by GET /api/utilidades.
// They are computed in utilidades/domain:
//   participation = the shareholder's accumulated contributions / the group's
//   pool          = interest paid for that month by everyone (target_month)
//   distribution  = participation × pool, rounded to the peso
export type MonthlyUtility = {
  month_number: number; // 1..12
  participation: number; // 0..1
  utilities_pool: number;
  distribution: number;
};

// Préstamos del accionista en pending_disbursement con upfront=true que
// todavía no tienen recibo (pending o approved) cubriendo las acciones
// por préstamo. Se renderiza como una sección no editable en /compras.
export type PendingLoanSharePurchase = {
  loan_id: string;
  loan_created_at: string;
  requested_amount: number;
  loan_shares_count: number | null;
  loan_shares_amount: number;
  unit_value: number | null;
};

// PostgreSQL responde 42501 cuando el rol no tiene EXECUTE sobre la RPC. Le
// pasa a anon (sesión vencida o ausente) desde 20261026000000, que dejó las
// RPC del accionista solo para authenticated.
export function isPermissionDeniedError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === '42501'
  );
}

export async function getMyPendingLoanSharePurchases(
  supabase: SB,
): Promise<PendingLoanSharePurchase[]> {
  const { data, error } = await supabase.rpc(
    'get_my_pending_loan_share_purchases',
  );
  if (error) throw error;
  return (data ?? []).map((row) => ({
    loan_id: row.loan_id,
    loan_created_at: row.loan_created_at,
    requested_amount: Number(row.requested_amount),
    loan_shares_count:
      row.loan_shares_count == null ? null : Number(row.loan_shares_count),
    loan_shares_amount: Number(row.loan_shares_amount),
    unit_value: row.unit_value == null ? null : Number(row.unit_value),
  }));
}

export async function countMyPendingLoanSharePurchases(
  supabase: SB,
): Promise<number> {
  const { data, error } = await supabase.rpc(
    'count_my_pending_loan_share_purchases',
  );
  if (error) throw error;
  return Number(data ?? 0);
}

// Resumen por préstamo activo del accionista actual: saldo de capital,
// intereses adeudados (calculados a mes vencido sobre saldo histórico),
// meses vencidos y target_month a usar para los receipt_items del pago.
export type ActiveLoanDebt = {
  loan_id: string;
  loan_number: number | null;
  disbursement_number: string | null;
  requested_amount: number;
  outstanding_capital: number;
  interest_rate: number;
  disbursed_at: string;
  interest_owed: number;
  months_overdue: number;
  next_due_month: string; // 'YYYY-MM-DD'
};

// Same result as the former SQL `get_user_active_loans_debt`, with the
// interest owed from the domain (summarizeActiveLoanDebt, section 11 n.º 13).
// `today` defaults to the Bogota date of the clock.
export async function getMyActiveLoansDebt(supabase: SB, today?: FechaISO): Promise<ActiveLoanDebt[]> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const userId = auth.user?.id;
  if (!userId) return [];

  const { data: loans, error } = await supabase
    .from('loans')
    .select('id, loan_number, disbursement_number, requested_amount, interest_rate, disbursed_at, full_rate_day_limit, cutoff_day')
    .eq('user_id', userId)
    .eq('status', 'active')
    .not('disbursed_at', 'is', null);
  if (error) throw error;
  const rows = (loans ?? []).filter((l): l is typeof l & { disbursed_at: string } => l.disbursed_at != null);
  if (rows.length === 0) return [];

  const itemsByLoan = await getLoanInterestItems(supabase, rows.map((l) => l.id));
  const ajustes = await getAjustesDePrestamo(supabase);
  return rows.map((loan) => {
    // RN-4.21b: each disbursed loan is computed with its own stored days.
    const ajustesPropios = ajustesDelPrestamo(loan, ajustes);
    if (!ajustesPropios.ok) {
      throw new Error(`No se pudo calcular la deuda del préstamo ${loan.id}: ${ajustesPropios.error.mensaje}`);
    }
    const summary = summarizeActiveLoanDebt({
      requestedAmount: loan.requested_amount,
      rate: loan.interest_rate,
      disbursedAt: loan.disbursed_at,
      items: itemsByLoan.get(loan.id) ?? [],
      today,
      ajustes: ajustesPropios.value,
    });
    if (!summary.ok) {
      throw new Error(`No se pudo calcular la deuda del préstamo ${loan.id}: ${summary.error.mensaje}`);
    }
    return {
      loan_id: loan.id,
      loan_number: loan.loan_number,
      disbursement_number: loan.disbursement_number,
      requested_amount: Number(loan.requested_amount),
      outstanding_capital: summary.value.outstandingCapital,
      interest_rate: Number(loan.interest_rate),
      disbursed_at: loan.disbursed_at,
      interest_owed: summary.value.interestOwed,
      months_overdue: summary.value.monthsOverdue,
      next_due_month: summary.value.nextDueMonth,
    };
  });
}

// Interest still owed by one loan, counting approved receipts only (as the
// former SQL `get_loan_interest_owed` did). A loan that does not exist or is
// not disbursed owes 0. Throws when the domain rejects the data.
export async function getLoanInterestOwed(supabase: SB, loanId: string, today?: FechaISO): Promise<number> {
  const { data: loan, error } = await supabase
    .from('loans')
    .select('id, requested_amount, interest_rate, disbursed_at, full_rate_day_limit, cutoff_day')
    .eq('id', loanId)
    .maybeSingle();
  if (error) throw error;
  if (!loan?.disbursed_at) return 0;

  // RN-4.21b: the loan is computed with its own stored days.
  const ajustes = ajustesDelPrestamo(loan, await getAjustesDePrestamo(supabase));
  if (!ajustes.ok) {
    throw new Error(`No se pudo calcular el interés del préstamo ${loan.id}: ${ajustes.error.mensaje}`);
  }
  const itemsByLoan = await getLoanInterestItems(supabase, [loan.id]);
  const owed = calcAccruedInterest({
    requestedAmount: loan.requested_amount,
    rate: loan.interest_rate,
    disbursedAt: loan.disbursed_at,
    items: itemsByLoan.get(loan.id) ?? [],
    today,
    ajustes: ajustes.value,
  });
  if (!owed.ok) {
    throw new Error(`No se pudo calcular el interés del préstamo ${loan.id}: ${owed.error.mensaje}`);
  }
  return owed.value;
}

// Préstamos del accionista que ya pasaron la votación y están a la espera
// del desembolso por parte del admin. Se notifica una vez (hasta que el
// accionista entra a /dashboard/prestamos y dispara mark_my_loans_status_seen).
export async function countLoansReadyForDisbursementForUser(
  supabase: SB,
  userId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('loans')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'pending_disbursement')
    .is('borrower_seen_status_at', null);
  if (error) throw error;
  return count ?? 0;
}

// Préstamos del accionista recién pasados a active (desembolsados) que aún
// no fueron vistos. El trigger `reset_borrower_seen_on_status_change`
// pone el seen en NULL al cambiar de status, así que esto naturalmente
// muestra solo los recién desembolsados.
export async function countLoansActiveUnseenForUser(
  supabase: SB,
  userId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('loans')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'active')
    .is('borrower_seen_status_at', null);
  if (error) throw error;
  return count ?? 0;
}

// Préstamos del accionista que requieren su atención: devueltos a draft
// para corregir, o rechazados por el admin / por la votación que aún no
// fueron vistos por el accionista. Lo usa el dropdown del header y el
// badge del item "Préstamos".
//
// Los rechazados se "marcan como vistos" (borrower_seen_status_at) la
// primera vez que el user entra a /dashboard/prestamos vía la RPC
// mark_my_loans_status_seen. A partir de ahí dejan de contar.
export async function countLoansRequiringActionForUser(
  supabase: SB,
  userId: string,
): Promise<number> {
  const [draftRes, rejectedRes] = await Promise.all([
    supabase
      .from('loans')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'draft'),
    supabase
      .from('loans')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('status', ['rejected_by_admin', 'rejected_by_shareholders'])
      .is('borrower_seen_status_at', null),
  ]);

  if (draftRes.error) throw draftRes.error;
  if (rejectedRes.error) throw rejectedRes.error;
  return (draftRes.count ?? 0) + (rejectedRes.count ?? 0);
}

// Cuántos préstamos están esperando el voto de este accionista. Excluye
// los propios y los que ya votó. Lo usa el badge del nav y el dropdown
// del header del accionista.
export async function countLoansAwaitingMyVote(
  supabase: SB,
  voterId: string,
): Promise<number> {
  const { data: loans, error } = await supabase
    .from('loans')
    .select('id, user_id')
    .eq('status', 'pending_shareholder_vote');
  if (error) throw error;
  if (!loans || loans.length === 0) return 0;

  const others = loans.filter((l) => l.user_id !== voterId);
  if (others.length === 0) return 0;

  const ids = others.map((l) => l.id);
  const { data: myVotes, error: votesErr } = await supabase
    .from('loan_votes')
    .select('loan_id')
    .eq('voter_id', voterId)
    .in('loan_id', ids);
  if (votesErr) throw votesErr;

  const voted = new Set((myVotes ?? []).map((v) => v.loan_id));
  return others.filter((l) => !voted.has(l.id)).length;
}

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

export type LoanWithBorrower = Loan & {
  borrower: {
    id: string;
    first_name: string;
    last_name: string;
    identity_document: string;
    role: Profile['role'];
  } | null;
};

export async function getAllLoans(supabase: SB): Promise<LoanWithBorrower[]> {
  const { data, error } = await supabase
    .from('loans')
    .select(
      `*, borrower:profiles!loans_user_id_fkey(id, first_name, last_name, identity_document, role)`,
    )
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as LoanWithBorrower[];
}

// `eligible_voters` is n from RN-4.6: active shareholders except the applicant.
export type LoanWithVoting = LoanWithDetails & { eligible_voters: number };

export async function getLoanWithDetails(
  supabase: SB,
  id: string,
): Promise<LoanWithVoting | null> {
  const [loanRes, planRes, votesRes, voteTotalsRes, totalRes] = await Promise.all([
    supabase
      .from('loans')
      .select(`*, borrower:profiles!loans_user_id_fkey(id,first_name,last_name,identity_document,role)`)
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('loan_payment_plan_items')
      .select('*')
      .eq('loan_id', id)
      .order('month_number'),
    // RN-4.9b: RLS returns only the caller's own vote; progress comes from totals.
    supabase
      .from('loan_votes')
      .select('*')
      .eq('loan_id', id),
    supabase.rpc('get_loan_vote_totals', { p_loan_ids: [id] }),
    supabase.rpc('count_active_shareholders'),
  ]);

  if (loanRes.error) throw loanRes.error;
  if (!loanRes.data) return null;
  if (voteTotalsRes.error) throw voteTotalsRes.error;

  const votes = votesRes.data ?? [];
  const voteTotals = voteTotalsRes.data?.[0];
  const approvedVotes = Number(voteTotals?.approved ?? 0);
  const rejectedVotes = Number(voteTotals?.rejected ?? 0);

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
  const borrower = loan.borrower as (LoanWithDetails['borrower'] & { role?: Profile['role'] }) | null;
  const totalShareholders = Number(totalRes.data ?? 0);

  return {
    ...(loan as unknown as Loan),
    borrower: borrower ?? null,
    payment_plan: (planRes.data ?? []) as LoanWithDetails['payment_plan'],
    votes: votes as unknown as LoanWithDetails['votes'],
    total_active_shareholders: totalShareholders,
    eligible_voters: eligibleVoterCount({ totalShareholders, applicantRole: borrower?.role }),
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

export type LoanWithBorrowerName = Loan & {
  borrower: Pick<Profile, 'first_name' | 'last_name'> | null;
};

export async function getLoansWithDisbursement(supabase: SB): Promise<LoanWithBorrowerName[]> {
  const { data, error } = await supabase
    .from('loans')
    .select(`*, borrower:profiles!loans_user_id_fkey(first_name, last_name)`)
    .in('status', ['active', 'paid'])
    .not('disbursement_number', 'is', null)
    .order('disbursed_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as LoanWithBorrowerName[];
}

// ============================================================
// Libro de accionista
// ============================================================

export interface LibroAccionistaPayment {
  loan_id: string;
  concept: 'pago_capital' | 'pago_intereses';
  amount: number;
  target_month: string;
}

export interface LibroAccionistaLoan {
  loan: Loan;
  plan: Array<{
    month_number: number;
    due_date: string;
    capital_amount: number;
    estimated_interest: number;
    estimated_balance_after: number;
  }>;
  payments: LibroAccionistaPayment[];
}

export interface LibroAccionistaEntry {
  user: {
    id: string;
    first_name: string;
    last_name: string;
    identity_document: string;
  };
  loans: LibroAccionistaLoan[];
}

// Trae todos los préstamos desembolsados agrupados por accionista, incluyendo
// su plan teórico y los pagos reales (items de recibos aprobados). Esta es la
// fuente única de verdad para el "Libro de accionista".
//
// Si se pasa `userId`, filtra solo los préstamos de ese accionista (se usa
// desde la página de extracto para el resumen personal).
export async function getLibroAccionistaData(
  supabase: SB,
  userId?: string,
): Promise<LibroAccionistaEntry[]> {
  // 1. Préstamos desembolsados con perfil del borrower.
  let query = supabase
    .from('loans')
    .select(
      `*, borrower:profiles!loans_user_id_fkey(id, first_name, last_name, identity_document)`,
    )
    .in('status', ['active', 'paid'])
    .not('disbursement_number', 'is', null)
    .order('disbursed_at', { ascending: true });
  if (userId) query = query.eq('user_id', userId);
  const { data: loansData, error: loansErr } = await query;
  if (loansErr) throw loansErr;
  const loans = (loansData ?? []) as Array<
    Loan & {
      borrower: {
        id: string;
        first_name: string;
        last_name: string;
        identity_document: string;
      } | null;
    }
  >;

  if (loans.length === 0) return [];
  const loanIds = loans.map((l) => l.id);

  // 2. Plan de pagos (todas las filas de los préstamos de interés).
  const { data: planData } = await supabase
    .from('loan_payment_plan_items')
    .select('loan_id, month_number, due_date, capital_amount, estimated_interest, estimated_balance_after')
    .in('loan_id', loanIds)
    .order('month_number');

  const planByLoan = new Map<string, LibroAccionistaLoan['plan']>();
  for (const row of planData ?? []) {
    const r = row as Record<string, unknown>;
    const loanId = r.loan_id as string;
    const list = planByLoan.get(loanId) ?? [];
    list.push({
      month_number: Number(r.month_number),
      due_date: String(r.due_date),
      capital_amount: Number(r.capital_amount),
      estimated_interest: Number(r.estimated_interest),
      estimated_balance_after: Number(r.estimated_balance_after),
    });
    planByLoan.set(loanId, list);
  }

  // 3. Pagos reales: receipt_items con loan_id y concepto de pago, solo recibos aprobados.
  const { data: paymentData } = await supabase
    .from('receipt_items')
    .select('loan_id, concept, amount, target_month, receipts!inner(status)')
    .in('loan_id', loanIds)
    .in('concept', ['pago_capital', 'pago_intereses']);

  const paymentsByLoan = new Map<string, LibroAccionistaPayment[]>();
  for (const row of paymentData ?? []) {
    const r = row as Record<string, unknown> & { receipts: { status: string } | null };
    if (!r.receipts || r.receipts.status !== 'approved') continue;
    const loanId = r.loan_id as string;
    const list = paymentsByLoan.get(loanId) ?? [];
    list.push({
      loan_id: loanId,
      concept: r.concept as 'pago_capital' | 'pago_intereses',
      amount: Number(r.amount),
      target_month: String(r.target_month),
    });
    paymentsByLoan.set(loanId, list);
  }

  // 4. Agrupar préstamos por accionista.
  const byUser = new Map<string, LibroAccionistaEntry>();
  for (const loan of loans) {
    if (!loan.borrower) continue;
    const userId = loan.borrower.id;
    let entry = byUser.get(userId);
    if (!entry) {
      entry = {
        user: {
          id: loan.borrower.id,
          first_name: loan.borrower.first_name,
          last_name: loan.borrower.last_name,
          identity_document: loan.borrower.identity_document,
        },
        loans: [],
      };
      byUser.set(userId, entry);
    }
    entry.loans.push({
      loan: loan as Loan,
      plan: planByLoan.get(loan.id) ?? [],
      payments: paymentsByLoan.get(loan.id) ?? [],
    });
  }

  return Array.from(byUser.values()).sort((a, b) =>
    `${a.user.first_name} ${a.user.last_name}`.localeCompare(
      `${b.user.first_name} ${b.user.last_name}`,
    ),
  );
}

// Rows per request; it matches the default PostgREST `max-rows`, so a full
// page means there may be more.
export const LOAN_INTEREST_ITEMS_PAGE_SIZE = 1000;

// Approved capital and interest items of the given loans for the domain
// interest owed (calcAccruedInterest). Loans without items map to []. It pages
// through the results ordered by id, so it never truncates silently (R3-004).
export async function getLoanInterestItems(
  supabase: SB,
  loanIds: string[],
): Promise<Map<string, LoanInterestItem[]>> {
  const porPrestamo = new Map<string, LoanInterestItem[]>(loanIds.map((id) => [id, []]));
  if (loanIds.length === 0) return porPrestamo;

  for (let desde = 0; ; desde += LOAN_INTEREST_ITEMS_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('receipt_items')
      .select('id, loan_id, concept, target_month, amount, receipts!inner(status)')
      .in('loan_id', loanIds)
      .in('concept', ['pago_capital', 'pago_intereses'])
      .eq('receipts.status', 'approved')
      .order('id')
      .range(desde, desde + LOAN_INTEREST_ITEMS_PAGE_SIZE - 1);
    if (error) throw error;

    const pagina = data ?? [];
    for (const item of pagina) {
      if (!item.loan_id) continue;
      porPrestamo.get(item.loan_id)?.push({
        concept: item.concept,
        target_month: item.target_month,
        amount: item.amount,
      });
    }
    if (pagina.length < LOAN_INTEREST_ITEMS_PAGE_SIZE) return porPrestamo;
  }
}
