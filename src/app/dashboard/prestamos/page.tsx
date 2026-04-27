'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Plus, ChevronRight, Vote, ThumbsUp, ThumbsDown, Clock } from 'lucide-react';
import { getLoansForUser, getLoansForVoting } from '@/lib/data/loans';
import type { Loan } from '@/types/entities';
import { cop } from '@/lib/format';
import { LOAN_STATUS_LABELS, LOAN_STATUS_TONE, requiredVotes } from '@/lib/loans';

type VotingLoan = Loan & { has_voted: boolean; borrower_name: string };

// Conteo de votos por loan — solo lo cargamos para los que están en
// `pending_shareholder_vote`, así el accionista ve el progreso sin entrar
// al detalle. `pending` es los que faltan para alcanzar el quorum.
type VoteSummary = { approved: number; rejected: number };

export default function PrestamosPage() {
  const router = useRouter();
  const [myLoans, setMyLoans] = useState<Loan[]>([]);
  const [votingLoans, setVotingLoans] = useState<VotingLoan[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Conteo de votos por loan_id — solo se llena para los préstamos en
  // votación del propio user.
  const [voteSummaries, setVoteSummaries] = useState<Map<string, VoteSummary>>(
    new Map(),
  );
  const [totalShareholders, setTotalShareholders] = useState<number>(0);

  // Refresca préstamos propios + préstamos en votación. Se llama en mount
  // y cada vez que llega un evento realtime sobre la tabla loans.
  const refresh = useCallback(async (uid: string) => {
    try {
      const [loans, voting, totalRes] = await Promise.all([
        getLoansForUser(supabase, uid),
        getLoansForVoting(supabase, uid),
        supabase.rpc('count_active_shareholders'),
      ]);
      setMyLoans(loans);
      setVotingLoans(voting);
      setTotalShareholders(Number(totalRes.data ?? 0));

      // Para cada préstamo propio en votación, traemos sus votos. La RLS
      // permite SELECT sobre loan_votes a cualquier accionista, así que
      // ver el conteo de su propio préstamo está OK.
      const inVoting = loans.filter((l) => l.status === 'pending_shareholder_vote');
      if (inVoting.length === 0) {
        setVoteSummaries(new Map());
        return;
      }
      const ids = inVoting.map((l) => l.id);
      const { data: votes } = await supabase
        .from('loan_votes')
        .select('loan_id, vote')
        .in('loan_id', ids);

      const map = new Map<string, VoteSummary>();
      for (const id of ids) map.set(id, { approved: 0, rejected: 0 });
      for (const v of votes ?? []) {
        const s = map.get(v.loan_id);
        if (!s) continue;
        if (v.vote === 'approve') s.approved += 1;
        else if (v.vote === 'reject') s.rejected += 1;
      }
      setVoteSummaries(map);
    } catch (err) {
      console.error('Error cargando préstamos del accionista:', err);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/login'); return; }
      if (cancelled) return;
      setUserId(user.id);
      await refresh(user.id);
      if (!cancelled) setLoading(false);

      // Marca como "vistos" todos los préstamos del user que disparan
      // notificación (rechazos, listos para desembolso, recién activos).
      // El badge correspondiente desaparece a partir de ahora. El UPDATE
      // dispara evento realtime sobre loans → el layout recalcula los
      // conteos automáticamente.
      try {
        await supabase.rpc('mark_my_loans_status_seen');
      } catch (err) {
        console.warn('No se pudieron marcar préstamos como vistos:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [router, refresh]);

  // Realtime: cualquier cambio en loans (nuevo préstamo, voto procesado,
  // cambio de status, desembolso) refresca la vista, y también escuchamos
  // loan_votes para que el resumen "X a favor / Y en contra" se actualice
  // en vivo cuando otro accionista vota nuestro préstamo.
  // RLS filtra qué préstamos / votos puede ver este accionista.
  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(`accionista-prestamos-live-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'loans' },
        () => refresh(userId),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'loan_votes' },
        () => refresh(userId),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId, refresh]);

  if (loading) {
    return <div className="animate-pulse text-[var(--color-text-subtle)] text-sm">Cargando…</div>;
  }

  return (
    <div className="flex flex-col gap-7 animate-in fade-in duration-300">
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
      {votingLoans.filter((l) => !l.has_voted && l.user_id !== userId).length > 0 && (
        <Card padding="none" className="border-[var(--color-info)]/30">
          <div className="px-5 pt-[18px] pb-3.5 flex items-center gap-3">
            <div className="w-8 h-8 rounded-[8px] bg-[var(--color-info-soft)] text-[var(--color-info)] flex items-center justify-center">
              <Vote size={16} strokeWidth={1.75} />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight">Solicitudes esperando tu voto</div>
              <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
                Hay {votingLoans.filter((l) => !l.has_voted && l.user_id !== userId).length} préstamo(s) en votación
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
  voteSummary?: VoteSummary;
  totalShareholders: number;
}) {
  const tone = LOAN_STATUS_TONE[loan.status] as 'success' | 'warn' | 'danger' | 'info' | 'brand' | 'neutral';
  const inVoting = loan.status === 'pending_shareholder_vote';
  // Total de votantes elegibles = accionistas activos - 1 (el solicitante
  // no vota su propio préstamo). Si por algún motivo el RPC devolvió 0,
  // mostramos solo lo recibido sin "de N".
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

        {/* Resumen de votación — solo cuando el préstamo está esperando
            que voten los accionistas. Mostramos a favor / en contra /
            faltantes y cuántos votos hacen falta para aprobar. */}
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
