'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Plus, ChevronRight, Vote } from 'lucide-react';
import { getLoansForUser, getLoansForVoting } from '@/lib/data/loans';
import type { Loan } from '@/types/entities';
import { cop } from '@/lib/format';
import { LOAN_STATUS_LABELS, LOAN_STATUS_TONE } from '@/lib/loans';

type VotingLoan = Loan & { has_voted: boolean; borrower_name: string };

export default function PrestamosPage() {
  const router = useRouter();
  const [myLoans, setMyLoans] = useState<Loan[]>([]);
  const [votingLoans, setVotingLoans] = useState<VotingLoan[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/login'); return; }
      if (cancelled) return;
      setUserId(user.id);

      const [loans, voting] = await Promise.all([
        getLoansForUser(supabase, user.id),
        getLoansForVoting(supabase, user.id),
      ]);

      if (cancelled) return;
      setMyLoans(loans);
      setVotingLoans(voting);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [router]);

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
            <LoanRow key={loan.id} loan={loan} />
          ))}
        </Card>
      )}
    </div>
  );
}

function LoanRow({ loan }: { loan: Loan }) {
  const tone = LOAN_STATUS_TONE[loan.status] as 'success' | 'warn' | 'danger' | 'info' | 'brand' | 'neutral';
  return (
    <Link
      href={`/dashboard/prestamos/${loan.id}`}
      className="flex items-center gap-4 px-5 py-4 border-t border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]/50 transition-colors"
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
      </div>
      <Badge tone={tone as Parameters<typeof Badge>[0]['tone']}>
        {LOAN_STATUS_LABELS[loan.status]}
      </Badge>
      <ChevronRight size={16} strokeWidth={1.75} className="text-[var(--color-text-subtle)] shrink-0" />
    </Link>
  );
}
