'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { showToast } from '@/components/ui/Toast';
import { ThumbsUp, ThumbsDown, ChevronRight, CheckCircle2, Clock } from 'lucide-react';
import { getLoansForVoting, getMyVotingHistory, type VoteHistoryItem } from '@/lib/data/loans';
import type { Loan } from '@/types/entities';
import { cop } from '@/lib/format';
import { LOAN_STATUS_LABELS, LOAN_STATUS_TONE } from '@/lib/loans';

type VotingLoan = Loan & { has_voted: boolean; borrower_name: string };

export default function VotarPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [loans, setLoans] = useState<VotingLoan[]>([]);
  const [history, setHistory] = useState<VoteHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState<Record<string, 'approved' | 'rejected' | null>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);

  const reload = async (uid: string) => {
    const [data, hist] = await Promise.all([
      getLoansForVoting(supabase, uid),
      getMyVotingHistory(supabase, uid),
    ]);
    setLoans(data);
    setHistory(hist);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/login'); return; }
      if (cancelled) return;
      setUserId(user.id);
      await reload(user.id);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [router]);

  const handleVote = async (loanId: string, vote: 'approved' | 'rejected') => {
    setSubmitting(loanId);
    try {
      const res = await fetch(`/api/prestamos/${loanId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vote }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast('error', json?.error ?? 'No se pudo registrar el voto');
      } else {
        showToast('success', vote === 'approved' ? 'Votaste a favor' : 'Votaste en contra');
        if (userId) await reload(userId);
      }
    } catch {
      showToast('error', 'Error al votar');
    } finally {
      setSubmitting(null);
    }
  };

  if (loading) {
    return <div className="animate-pulse text-[var(--color-text-subtle)] text-sm">Cargando…</div>;
  }

  const pendingToVote = loans.filter((l) => !l.has_voted && l.user_id !== userId);
  const alreadyVoted = loans.filter((l) => (l.has_voted || l.user_id === userId));

  // Filtrar del historial los préstamos que ya están en la lista activa
  const activeIds = new Set(loans.map((l) => l.id));
  const closedHistory = history.filter((h) => !activeIds.has(h.loan.id));

  return (
    <div className="flex flex-col gap-7 animate-in fade-in duration-300">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.025em] leading-[1.15]">
            Votación de préstamos
          </h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1.5">
            Aprobá o rechazá las solicitudes de tus compañeros.
          </p>
        </div>
        <Link href="/dashboard/prestamos">
          <Button variant="secondary" size="sm">← Volver</Button>
        </Link>
      </header>

      {pendingToVote.length === 0 && alreadyVoted.length === 0 && closedHistory.length === 0 && (
        <Card padding="lg" className="text-center">
          <div className="text-[var(--color-text-muted)] text-sm">
            No hay préstamos en votación en este momento.
          </div>
        </Card>
      )}

      {pendingToVote.length > 0 && (
        <div className="flex flex-col gap-4">
          <SectionLabel>Esperando tu voto</SectionLabel>
          {pendingToVote.map((loan) => (
            <VotingCard
              key={loan.id}
              loan={loan}
              pending={submitting === loan.id}
              selectedVote={voting[loan.id] ?? null}
              onSelectVote={(v) => setVoting((prev) => ({ ...prev, [loan.id]: v }))}
              onConfirmVote={() => {
                const v = voting[loan.id];
                if (v) handleVote(loan.id, v);
              }}
            />
          ))}
        </div>
      )}

      {alreadyVoted.length > 0 && (
        <div className="flex flex-col gap-3">
          <SectionLabel>En curso — ya votados</SectionLabel>
          {alreadyVoted.map((loan) => (
            <ActiveVotedRow key={loan.id} loan={loan} userId={userId} />
          ))}
        </div>
      )}

      {closedHistory.length > 0 && (
        <div className="flex flex-col gap-3">
          <SectionLabel>Historial de votaciones</SectionLabel>
          {closedHistory.map((item) => (
            <HistoryRow key={item.vote.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold text-[var(--color-text-subtle)] tracking-[0.12em] uppercase px-1">
      {children}
    </div>
  );
}

function ActiveVotedRow({ loan, userId }: { loan: VotingLoan; userId: string | null }) {
  const isOwn = loan.user_id === userId;
  return (
    <div className="flex items-center gap-4 px-5 py-4 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-alt)]/50">
      <CheckCircle2 size={18} strokeWidth={1.75} className="text-[var(--color-success)] shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold">
          {loan.borrower_name} — {cop(Number(loan.requested_amount))}
        </div>
        <div className="text-[11px] text-[var(--color-text-subtle)] mt-0.5">
          {loan.payment_plan_months} meses · {isOwn ? 'Tu préstamo' : 'Ya votaste'}
        </div>
      </div>
      <Link href={`/dashboard/prestamos/${loan.id}`}>
        <ChevronRight size={16} strokeWidth={1.75} className="text-[var(--color-text-subtle)]" />
      </Link>
    </div>
  );
}

function HistoryRow({ item }: { item: VoteHistoryItem }) {
  const { loan, vote } = item;
  const statusTone = LOAN_STATUS_TONE[loan.status] as Parameters<typeof Badge>[0]['tone'];
  const votedFor = vote.vote === 'approved';

  const outcomeSettled = ['active', 'paid', 'rejected_by_shareholders', 'rejected_by_admin'].includes(loan.status);

  return (
    <div className="flex items-center gap-4 px-5 py-4 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
          votedFor ? 'bg-[var(--color-success-soft)]' : 'bg-[var(--color-danger-soft)]'
        }`}
      >
        {votedFor ? (
          <ThumbsUp size={14} strokeWidth={1.75} className="text-[var(--color-success)]" />
        ) : (
          <ThumbsDown size={14} strokeWidth={1.75} className="text-[var(--color-danger)]" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold">
          {loan.borrower_name} — {cop(Number(loan.requested_amount))}
        </div>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className="text-[11px] text-[var(--color-text-subtle)]">
            Voté <b>{votedFor ? 'a favor' : 'en contra'}</b>
          </span>
          <span className="text-[var(--color-border)]">·</span>
          {outcomeSettled ? (
            <Badge tone={statusTone} className="text-[10px]">
              {LOAN_STATUS_LABELS[loan.status]}
            </Badge>
          ) : (
            <span className="flex items-center gap-1 text-[11px] text-[var(--color-text-subtle)]">
              <Clock size={11} strokeWidth={1.75} />
              {LOAN_STATUS_LABELS[loan.status]}
            </span>
          )}
        </div>
      </div>

      <Link href={`/dashboard/prestamos/${loan.id}`}>
        <ChevronRight size={16} strokeWidth={1.75} className="text-[var(--color-text-subtle)]" />
      </Link>
    </div>
  );
}

function VotingCard({
  loan,
  pending,
  selectedVote,
  onSelectVote,
  onConfirmVote,
}: {
  loan: VotingLoan;
  pending: boolean;
  selectedVote: 'approved' | 'rejected' | null;
  onSelectVote: (v: 'approved' | 'rejected') => void;
  onConfirmVote: () => void;
}) {
  return (
    <Card padding="lg">
      <div className="flex flex-col sm:flex-row sm:items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-semibold tracking-tight">{loan.borrower_name}</div>
          <div className="flex flex-wrap gap-3 mt-2 text-[13px] text-[var(--color-text-muted)]">
            <span>Monto: <b className="text-[var(--color-text)]">{cop(Number(loan.requested_amount))}</b></span>
            <span>·</span>
            <span>Plazo: <b className="text-[var(--color-text)]">{loan.payment_plan_months} meses</b></span>
            <span>·</span>
            <span>Tasa: <b className="text-[var(--color-text)]">{Number(loan.interest_rate) * 100}% mensual</b></span>
          </div>
          <Link
            href={`/dashboard/prestamos/${loan.id}`}
            className="inline-flex items-center gap-1 mt-2 text-[12px] font-semibold text-[var(--color-brand)] hover:underline"
          >
            Ver plan de pagos <ChevronRight size={12} strokeWidth={2} />
          </Link>
        </div>

        <div className="flex flex-col gap-2 shrink-0">
          <div className="flex gap-2">
            <button
              onClick={() => onSelectVote('approved')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-[9px] text-[13px] font-semibold border transition-colors ${
                selectedVote === 'approved'
                  ? 'bg-[var(--color-success)] text-white border-[var(--color-success)]'
                  : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-success)] hover:text-[var(--color-success)]'
              }`}
            >
              <ThumbsUp size={14} strokeWidth={1.75} /> A favor
            </button>
            <button
              onClick={() => onSelectVote('rejected')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-[9px] text-[13px] font-semibold border transition-colors ${
                selectedVote === 'rejected'
                  ? 'bg-[var(--color-danger)] text-white border-[var(--color-danger)]'
                  : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]'
              }`}
            >
              <ThumbsDown size={14} strokeWidth={1.75} /> En contra
            </button>
          </div>
          {selectedVote && (
            <Button
              size="sm"
              variant={selectedVote === 'approved' ? 'primary' : 'secondary'}
              disabled={pending}
              onClick={onConfirmVote}
              className="w-full"
            >
              {pending ? 'Registrando…' : 'Confirmar voto'}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
