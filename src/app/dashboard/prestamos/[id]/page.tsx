'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { showToast } from '@/components/ui/Toast';
import { ChevronLeft, ThumbsUp, ThumbsDown, Users, AlertTriangle } from 'lucide-react';
import { getLoanWithDetails } from '@/lib/data/loans';
import type { LoanWithDetails } from '@/types/entities';
import { cop } from '@/lib/format';
import {
  LOAN_STATUS_LABELS,
  LOAN_STATUS_TONE,
  calcAccruedInterest,
  requiredVotes,
} from '@/lib/loans';

export default function LoanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [loan, setLoan] = useState<LoanWithDetails | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState<'approved' | 'rejected' | null>(null);
  const [submittingVote, setSubmittingVote] = useState(false);

  const load = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.replace('/login'); return; }
    setCurrentUserId(user.id);
    const data = await getLoanWithDetails(supabase, id);
    setLoan(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  const handleVote = async () => {
    if (!voting || submittingVote) return;
    setSubmittingVote(true);
    try {
      const res = await fetch(`/api/prestamos/${id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vote: voting }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast('error', json?.error ?? 'No se pudo votar');
      } else {
        showToast('success', 'Voto registrado');
        await load();
      }
    } catch {
      showToast('error', 'Error al votar');
    } finally {
      setSubmittingVote(false);
    }
  };

  if (loading) return <div className="animate-pulse text-[var(--color-text-subtle)] text-sm">Cargando…</div>;
  if (!loan) return <div className="text-sm text-[var(--color-text-muted)]">Préstamo no encontrado.</div>;

  const isOwner = currentUserId === loan.user_id;
  const myVote = loan.votes.find((v) => v.voter_id === currentUserId);
  const canVote = loan.status === 'pending_shareholder_vote' && !isOwner && !myVote;
  const needed = requiredVotes(loan.total_active_shareholders);
  const tone = LOAN_STATUS_TONE[loan.status] as Parameters<typeof Badge>[0]['tone'];

  const accruedInterest =
    loan.status === 'active' && loan.disbursed_at
      ? calcAccruedInterest({
          outstandingBalance: Number(loan.outstanding_balance),
          rate: Number(loan.interest_rate),
          disbursedAt: new Date(loan.disbursed_at),
          lastInterestPaymentDate: loan.last_interest_payment_date
            ? new Date(loan.last_interest_payment_date)
            : null,
        })
      : 0;

  return (
    <div className="flex flex-col gap-7 animate-in fade-in duration-300">
      <header className="flex items-center gap-3">
        <Link href="/dashboard/prestamos">
          <Button variant="secondary" size="sm">
            <ChevronLeft size={15} strokeWidth={1.75} /> Volver
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-[22px] font-semibold tracking-[-0.025em]">
              Préstamo {cop(Number(loan.requested_amount))}
            </h1>
            <Badge tone={tone}>{LOAN_STATUS_LABELS[loan.status]}</Badge>
          </div>
          <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
            Solicitado el {new Date(loan.created_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6 items-start">
        <div className="flex flex-col gap-5">
          {/* Detalles del préstamo */}
          <Card padding="lg">
            <h2 className="text-[14px] font-semibold tracking-tight mb-4">Detalles</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <Stat label="Monto solicitado" value={cop(Number(loan.requested_amount))} />
              <Stat label="Tasa mensual" value={`${Number(loan.interest_rate) * 100}%`} />
              <Stat label="Plazo" value={`${loan.payment_plan_months ?? '—'} meses`} />
              {loan.status === 'active' && (
                <>
                  <Stat label="Saldo pendiente" value={cop(Number(loan.outstanding_balance))} tone="warn" />
                  <Stat label="Intereses acumulados" value={cop(accruedInterest)} tone="danger" />
                  <Stat label="Desembolsado" value={loan.disbursed_amount ? cop(Number(loan.disbursed_amount)) : '—'} />
                </>
              )}
              {loan.status !== 'draft' && loan.status !== 'pending_review' && (
                <>
                  <Stat
                    label="Acciones por préstamo"
                    value={`${loan.loan_shares_count} (${cop(Number(loan.loan_shares_amount))})`}
                  />
                  <Stat label="4×1000" value={cop(Number(loan.four_per_thousand))} />
                </>
              )}
            </div>

            {loan.status === 'active' && accruedInterest > 0 && (
              <div className="mt-4 flex items-start gap-2 p-3 rounded-[10px] bg-[var(--color-warn-soft)] text-[var(--color-warn)] text-[12px]">
                <AlertTriangle size={14} strokeWidth={2} className="mt-px shrink-0" />
                <span>
                  Tenés <b>{cop(accruedInterest)}</b> en intereses acumulados. Debés pagarlos antes de abonar capital.
                </span>
              </div>
            )}

            {loan.rejection_reason && (
              <div className="mt-4 flex items-start gap-2 p-3 rounded-[10px] bg-[var(--color-danger-soft)] text-[var(--color-danger)] text-[12px]">
                <AlertTriangle size={14} strokeWidth={2} className="mt-px shrink-0" />
                <span>Motivo de rechazo: {loan.rejection_reason}</span>
              </div>
            )}

            {loan.plan_status === 'rejected' && loan.plan_rejection_reason && (
              <div className="mt-4 flex items-start gap-2 p-3 rounded-[10px] bg-[var(--color-danger-soft)] text-[var(--color-danger)] text-[12px]">
                <AlertTriangle size={14} strokeWidth={2} className="mt-px shrink-0" />
                <span>El plan de pagos fue rechazado: {loan.plan_rejection_reason}</span>
              </div>
            )}
          </Card>

          {/* Plan de pagos */}
          {loan.payment_plan.length > 0 && (
            <Card padding="none">
              <div className="px-[22px] pt-[18px] pb-3.5">
                <div className="text-[14px] font-semibold tracking-tight">Plan de pagos</div>
                <div className="text-[12px] text-[var(--color-text-muted)] mt-0.5">
                  Informativo — los montos reales pueden variar según los pagos efectivos.
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-t border-[var(--color-border)] bg-[var(--color-surface-alt)]">
                      {['Cuota', 'Vencimiento', 'Capital', 'Intereses', 'Saldo'].map((h) => (
                        <th key={h} className="text-left px-4 py-2.5 text-[10px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loan.payment_plan.map((row) => (
                      <tr key={row.month_number} className="border-t border-[var(--color-border)]">
                        <td className="px-4 py-3 text-[var(--color-text-muted)] font-semibold">#{row.month_number}</td>
                        <td className="px-4 py-3 text-[var(--color-text-muted)]">
                          {new Date(row.due_date + 'T12:00:00').toLocaleDateString('es-CO', { month: 'short', year: 'numeric' })}
                        </td>
                        <td className="px-4 py-3 font-semibold tabular">{cop(Number(row.capital_amount))}</td>
                        <td className="px-4 py-3 text-[var(--color-text-muted)] tabular">{cop(Number(row.estimated_interest))}</td>
                        <td className="px-4 py-3 tabular">{cop(Number(row.estimated_balance_after))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>

        {/* Panel lateral */}
        <div className="flex flex-col gap-4">
          {/* Votación */}
          {(loan.status === 'pending_shareholder_vote' || loan.approved_votes > 0 || loan.rejected_votes > 0) && (
            <Card padding="lg">
              <div className="flex items-center gap-2 mb-4">
                <Users size={16} strokeWidth={1.75} className="text-[var(--color-text-muted)]" />
                <div className="text-[14px] font-semibold tracking-tight">Votación</div>
              </div>

              <div className="flex gap-3 mb-4">
                <div className="flex-1 text-center p-3 rounded-[10px] bg-[var(--color-success-soft)]">
                  <div className="text-[20px] font-semibold text-[var(--color-success)]">{loan.approved_votes}</div>
                  <div className="text-[11px] text-[var(--color-text-muted)] mt-0.5">A favor</div>
                </div>
                <div className="flex-1 text-center p-3 rounded-[10px] bg-[var(--color-danger-soft)]">
                  <div className="text-[20px] font-semibold text-[var(--color-danger)]">{loan.rejected_votes}</div>
                  <div className="text-[11px] text-[var(--color-text-muted)] mt-0.5">En contra</div>
                </div>
              </div>

              <div className="text-[12px] text-[var(--color-text-muted)] text-center">
                Se necesitan <b>{needed}</b> votos a favor de {loan.total_active_shareholders} accionistas activos
              </div>

              {/* Barra de progreso */}
              <div className="mt-3 h-2 rounded-full bg-[var(--color-surface-alt)] overflow-hidden">
                <div
                  className="h-full bg-[var(--color-success)] rounded-full transition-all"
                  style={{ width: `${Math.min(100, (loan.approved_votes / Math.max(needed, 1)) * 100)}%` }}
                />
              </div>

              {canVote && (
                <div className="mt-4 flex flex-col gap-2">
                  <div className="flex gap-2">
                    <button
                      onClick={() => setVoting('approved')}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-[9px] text-[13px] font-semibold border transition-colors ${
                        voting === 'approved'
                          ? 'bg-[var(--color-success)] text-white border-[var(--color-success)]'
                          : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-success)]'
                      }`}
                    >
                      <ThumbsUp size={14} strokeWidth={1.75} /> A favor
                    </button>
                    <button
                      onClick={() => setVoting('rejected')}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-[9px] text-[13px] font-semibold border transition-colors ${
                        voting === 'rejected'
                          ? 'bg-[var(--color-danger)] text-white border-[var(--color-danger)]'
                          : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-danger)]'
                      }`}
                    >
                      <ThumbsDown size={14} strokeWidth={1.75} /> En contra
                    </button>
                  </div>
                  {voting && (
                    <Button size="sm" className="w-full" disabled={submittingVote} onClick={handleVote}>
                      {submittingVote ? 'Registrando…' : 'Confirmar voto'}
                    </Button>
                  )}
                </div>
              )}

              {myVote && (
                <div className="mt-3 text-center text-[12px] text-[var(--color-text-muted)]">
                  Votaste <b>{myVote.vote === 'approved' ? 'a favor' : 'en contra'}</b>
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' | 'danger' }) {
  const valueClass =
    tone === 'danger'
      ? 'text-[var(--color-danger)]'
      : tone === 'warn'
        ? 'text-[var(--color-warn)]'
        : 'text-[var(--color-text)]';
  return (
    <div>
      <div className="text-[10px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase mb-1">
        {label}
      </div>
      <div className={`text-[15px] font-semibold tabular ${valueClass}`}>{value}</div>
    </div>
  );
}
