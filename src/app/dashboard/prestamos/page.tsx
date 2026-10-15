import React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { LoanRepository } from '@/lib/domain/repositories/LoanRepository';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Plus, ChevronRight, Vote, ThumbsUp, ThumbsDown, Clock } from 'lucide-react';
import { cop } from '@/lib/format';
import { LOAN_STATUS_LABELS, LOAN_STATUS_TONE, requiredVotes } from '@/lib/loans';
import { PrestamosRealtime } from './PrestamosRealtime';
import type { Loan } from '@/types/entities';

// Metadata opcional para Next.js
export const metadata = {
  title: 'Mis préstamos',
};

// Next.js no permite pasar Maps de RSC a componentes cliente,
// y como LoanRow lo convertiremos en Server Component (o simplemente
// lo declaramos en el mismo archivo), no hay problema porque se 
// renderiza todo en el servidor.

export default async function PrestamosPage() {
  const supabase = await createSupabaseServerClient();
  const repo = new LoanRepository(supabase);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login');
  }

  // 1. Marcar como vistos (mutación segura en RSC al cargar la página)
  try {
    await supabase.rpc('mark_my_loans_status_seen');
  } catch (err) {
    console.warn('No se pudieron marcar préstamos como vistos:', err);
  }

  // 2. Cargar datos
  const [myLoans, votingLoans, totalShareholders] = await Promise.all([
    repo.getLoansForUser(user.id),
    repo.getLoansForVoting(user.id),
    repo.countActiveShareholders(),
  ]);

  // 3. Cargar resumen de votos para los préstamos propios en votación
  const inVotingIds = myLoans
    .filter((l) => l.status === 'pending_shareholder_vote')
    .map((l) => l.id);
  
  const voteSummaries = await repo.getVoteSummaries(inVotingIds);

  const loansToVote = votingLoans.filter((l) => !l.has_voted && l.user_id !== user.id);

  return (
    <div className="flex flex-col gap-7 animate-in fade-in duration-300">
      <PrestamosRealtime userId={user.id} />
      
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-5">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.025em] leading-[1.15]">Mis préstamos</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1.5">
            Gestioná tus solicitudes y préstamos activos.
          </p>
        </div>
        <Link href="/dashboard/prestamos/nueva">
          <Button size="md">
            <Plus size={15} strokeWidth={1.75} />
            Solicitar préstamo
          </Button>
        </Link>
      </header>

      {/* Préstamos en votación que me esperan */}
      {loansToVote.length > 0 && (
        <Card padding="none" className="border-[var(--color-info)]/30">
          <div className="px-5 pt-[18px] pb-3.5 flex items-center gap-3">
            <div className="w-8 h-8 rounded-[8px] bg-[var(--color-info-soft)] text-[var(--color-info)] flex items-center justify-center">
              <Vote size={16} strokeWidth={1.75} />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight">Solicitudes esperando tu voto</div>
              <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
                Hay {loansToVote.length} préstamo(s) en votación
              </div>
            </div>
            <Link href="/dashboard/prestamos/votar" className="ml-auto">
              <Button size="sm" variant="secondary">
                Ver y votar <ChevronRight size={14} strokeWidth={1.75} />
              </Button>
            </Link>
          </div>
        </Card>
      )}

      {/* Mis solicitudes */}
      {myLoans.length === 0 ? (
        <Card padding="lg" className="text-center">
          <div className="text-[var(--color-text-muted)] text-sm">
            Todavía no tenés solicitudes de préstamo.
          </div>
          <Link href="/dashboard/prestamos/nueva" className="inline-block mt-3">
            <Button size="sm">Solicitar mi primer préstamo</Button>
          </Link>
        </Card>
      ) : (
        <Card padding="none">
          <div className="px-5 pt-[18px] pb-3 text-sm font-semibold tracking-tight">
            Mis solicitudes
          </div>
          {myLoans.map((loan) => (
            <LoanRow
              key={loan.id}
              loan={loan}
              voteSummary={voteSummaries.get(loan.id)}
              totalShareholders={totalShareholders}
            />
          ))}
        </Card>
      )}
    </div>
  );
}

function LoanRow({
  loan,
  voteSummary,
  totalShareholders,
}: {
  loan: Loan;
  voteSummary?: { approved: number; rejected: number };
  totalShareholders: number;
}) {
  const tone = LOAN_STATUS_TONE[loan.status] as 'success' | 'warn' | 'danger' | 'info' | 'brand' | 'neutral';
  const inVoting = loan.status === 'pending_shareholder_vote';
  const eligibleVoters = Math.max(totalShareholders - 1, 0);
  const needed = requiredVotes(totalShareholders);
  const approved = voteSummary?.approved ?? 0;
  const rejected = voteSummary?.rejected ?? 0;
  const cast = approved + rejected;
  const pending = Math.max(eligibleVoters - cast, 0);

  return (
    <Link
      href={`/dashboard/prestamos/${loan.id}`}
      className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4 px-5 py-4 border-t border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]/50 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold">
          {cop(Number(loan.requested_amount))}
          <span className="text-[var(--color-text-muted)] font-normal ml-2">
            · {loan.payment_plan_months} meses
          </span>
        </div>
        <div className="text-[11px] text-[var(--color-text-subtle)] mt-0.5">
          {new Date(loan.created_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}
          {loan.status === 'active' && loan.outstanding_balance != null && (
            <> · Saldo: {cop(Number(loan.outstanding_balance))}</>
          )}
        </div>

        {inVoting && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px]">
            <span className="inline-flex items-center gap-1 text-[var(--color-success)] font-semibold">
              <ThumbsUp size={11} strokeWidth={2} />
              {approved} a favor
            </span>
            <span className="inline-flex items-center gap-1 text-[var(--color-danger)] font-semibold">
              <ThumbsDown size={11} strokeWidth={2} />
              {rejected} en contra
            </span>
            {totalShareholders > 0 && (
              <span className="inline-flex items-center gap-1 text-[var(--color-text-subtle)]">
                <Clock size={11} strokeWidth={2} />
                {pending} pendientes
              </span>
            )}
            {totalShareholders > 0 && (
              <span className="text-[var(--color-text-muted)]">
                · necesita{' '}
                <span className="font-semibold text-[var(--color-text)]">
                  {needed}
                </span>{' '}
                para aprobar
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 self-start md:self-auto shrink-0">
        <Badge tone={tone as Parameters<typeof Badge>[0]['tone']}>
          {LOAN_STATUS_LABELS[loan.status]}
        </Badge>
        <ChevronRight size={16} strokeWidth={1.75} className="text-[var(--color-text-subtle)]" />
      </div>
    </Link>
  );
}
