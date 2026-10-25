'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { showToast } from '@/components/ui/Toast';
import { ChevronLeft, ThumbsUp, ThumbsDown, Users, AlertTriangle, RotateCcw, Send } from 'lucide-react';
import { getLoanWithDetails, getMyActiveLoansDebt } from '@/lib/data/loans';
import type { LoanWithDetails } from '@/types/entities';
import { cop } from '@/lib/format';
import {
  LOAN_STATUS_LABELS,
  LOAN_STATUS_TONE,
  requiredVotes,
  computeLoanBook,
  type LoanBook,
} from '@/lib/loans';

export default function LoanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [loan, setLoan] = useState<LoanWithDetails | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState<'approved' | 'rejected' | null>(null);
  const [submittingVote, setSubmittingVote] = useState(false);
  const [resubmitting, setResubmitting] = useState(false);
  // Intereses adeudados al día (calculados por RPC sobre el saldo al
  // INICIO de cada mes vencido — la lógica correcta a "mes vencido"). Solo
  // aplica para el dueño del préstamo cuando está activo.
  const [accruedInterest, setAccruedInterest] = useState<number>(0);
  const [loanBook, setLoanBook] = useState<LoanBook | null>(null);

  const load = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.replace('/login'); return; }
    setCurrentUserId(user.id);
    const data = await getLoanWithDetails(supabase, id);
    setLoan(data);

    if (data) {
      // Traer pagos reales (receipt_items aprobados)
      try {
        const { data: paymentData, error: paymentErr } = await supabase
          .from('receipt_items')
          .select('concept, amount, target_month, receipts!inner(status)')
          .eq('loan_id', id)
          .in('concept', ['pago_capital', 'pago_intereses']);
        
        if (paymentErr) throw paymentErr;

        interface ReceiptItemRow {
          concept: string;
          amount: number | string;
          // receipt_items.target_month is `date not null` in the DB.
          target_month: string;
          receipts: { status: string } | { status: string }[] | null;
        }

        const approvedPayments = (paymentData as unknown as ReceiptItemRow[] ?? [])
          .filter((r) => {
            const status = Array.isArray(r.receipts)
              ? r.receipts[0]?.status
              : r.receipts?.status;
            return status === 'approved';
          })
          .map((r) => ({
            target_month: r.target_month,
            concept: r.concept as 'pago_capital' | 'pago_intereses',
            amount: Number(r.amount),
          }));

        const book = computeLoanBook({
          requestedAmount: Number(data.requested_amount),
          plan: data.payment_plan,
          payments: approvedPayments,
          interestRate: Number(data.interest_rate),
          disbursedAt: data.disbursed_at,
        });
        setLoanBook(book);
      } catch (err) {
        console.error('Error calculando conciliación del préstamo:', err);
      }
    }

    // Si soy el dueño y el préstamo está activo, traemos el interest_owed
    // desde el RPC get_user_active_loans_debt — calcula sobre el saldo
    // al inicio de cada mes vencido (no sobre el saldo actual).
    if (data && data.user_id === user.id && data.status === 'active') {
      try {
        const debts = await getMyActiveLoansDebt(supabase);
        const mine = debts.find((d) => d.loan_id === id);
        setAccruedInterest(mine?.interest_owed ?? 0);
      } catch (err) {
        console.error('Error cargando intereses acumulados:', err);
        setAccruedInterest(0);
      }
    } else {
      setAccruedInterest(0);
    }

    setLoading(false);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const handleResubmit = async () => {
    setResubmitting(true);
    try {
      const res = await fetch(`/api/prestamos/${id}/submit`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        showToast('error', json?.error ?? 'No se pudo reenviar la solicitud');
      } else {
        showToast('success', 'Solicitud reenviada al administrador.');
        await load();
      }
    } catch {
      showToast('error', 'Error al reenviar');
    } finally {
      setResubmitting(false);
    }
  };
  const needed = requiredVotes(loan.total_active_shareholders);
  const tone = LOAN_STATUS_TONE[loan.status] as Parameters<typeof Badge>[0]['tone'];

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

      {/* Banner: devuelto para revisión */}
      {isOwner && loan.status === 'draft' && loan.admin_notes && (
        <div className="flex items-start gap-3 p-4 rounded-[12px] bg-[var(--color-warn-soft)] border border-[var(--color-warn)]/30">
          <RotateCcw size={16} strokeWidth={2} className="text-[var(--color-warn)] mt-px shrink-0" />
          <div className="flex-1">
            <div className="text-[13px] font-semibold text-[var(--color-warn)]">El administrador solicitó una revisión</div>
            <div className="text-[12px] text-[var(--color-text-muted)] mt-0.5">{loan.admin_notes}</div>
            <p className="text-[11px] text-[var(--color-text-subtle)] mt-1.5">
              Editá tu plan de pagos desde <Link href={`/dashboard/prestamos/nueva`} className="text-[var(--color-brand)] underline">Nueva solicitud</Link> o reenviá esta solicitud sin cambios.
            </p>
          </div>
          <Button size="sm" disabled={resubmitting} onClick={handleResubmit}>
            <Send size={13} strokeWidth={1.75} />
            {resubmitting ? 'Enviando…' : 'Reenviar'}
          </Button>
        </div>
      )}

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
              {loanBook && (loan.status === 'active' || loan.status === 'paid') && (
                <>
                  <Stat label="Capital pagado" value={cop(loanBook.summary.total_paid_capital)} tone="success" />
                  <Stat label="Intereses pagados" value={cop(loanBook.summary.total_paid_interest)} tone="success" />
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
              {loan.deduct_obligations && (
                <>
                  <Stat label="Descontar deudas" value="Sí" />
                  {Number(loan.deducted_shares_amount || 0) > 0 && (
                    <Stat label="Acciones vencidas desc." value={cop(Number(loan.deducted_shares_amount))} tone="danger" />
                  )}
                  {Number(loan.deducted_fines_amount || 0) > 0 && (
                    <Stat label="Multas desc." value={cop(Number(loan.deducted_fines_amount))} tone="danger" />
                  )}
                  {Number(loan.deducted_interest_amount || 0) > 0 && (
                    <Stat label="Intereses desc." value={cop(Number(loan.deducted_interest_amount))} tone="danger" />
                  )}
                  {Number(loan.deducted_capital_amount || 0) > 0 && (
                    <Stat label="Abonos a capital desc." value={cop(Number(loan.deducted_capital_amount))} tone="danger" />
                  )}
                </>
              )}
              {loan.disbursed_amount === null && !['draft', 'rejected_by_admin', 'rejected_by_shareholders'].includes(loan.status) && (() => {
                const requested = Number(loan.requested_amount);
                const shares = loan.loan_shares_paid_upfront ? 0 : Number(loan.loan_shares_amount || 0);
                const deducted = loan.deduct_obligations
                  ? Number(loan.deducted_shares_amount || 0) +
                    Number(loan.deducted_fines_amount || 0) +
                    Number(loan.deducted_interest_amount || 0) +
                    Number(loan.deducted_capital_amount || 0)
                  : 0;
                const fourK = Number(loan.four_per_thousand || 0);
                const netToReceive = Math.max(0, requested - shares - deducted - fourK);
                return (
                  <Stat label="Neto a recibir (estimado)" value={cop(netToReceive)} tone="success" />
                );
              })()}
            </div>

            {loan.status === 'active' && accruedInterest > 0 && (
              <div className="mt-4 flex items-start gap-2 p-3 rounded-[10px] bg-[var(--color-warn-soft)] text-[var(--color-warn)] text-[12px]">
                <AlertTriangle size={14} strokeWidth={2} className="mt-px shrink-0" />
                <span>
                  Tenés <b>{cop(accruedInterest)}</b> en intereses acumulados. Debés pagarlos antes de abonar capital.
                </span>
              </div>
            )}

            {/* Banner de rechazo — uno solo. Si el préstamo fue rechazado
                mostramos su motivo (es el "ganador"); si solo el plan fue
                rechazado y no el préstamo entero, mostramos el del plan.
                Antes había dos banners y, cuando el motivo coincidía, se
                veía repetido. */}
            {loan.rejection_reason ? (
              <div className="mt-4 flex items-start gap-2 p-3 rounded-[10px] bg-[var(--color-danger-soft)] text-[var(--color-danger)] text-[12px]">
                <AlertTriangle size={14} strokeWidth={2} className="mt-px shrink-0" />
                <span>Motivo de rechazo: {loan.rejection_reason}</span>
              </div>
            ) : loan.plan_status === 'rejected' && loan.plan_rejection_reason ? (
              <div className="mt-4 flex items-start gap-2 p-3 rounded-[10px] bg-[var(--color-danger-soft)] text-[var(--color-danger)] text-[12px]">
                <AlertTriangle size={14} strokeWidth={2} className="mt-px shrink-0" />
                <span>El plan de pagos fue rechazado: {loan.plan_rejection_reason}</span>
              </div>
            ) : null}
          </Card>
          {/* Plan de pagos */}
          {loanBook && loanBook.months.length > 0 && (
            <Card padding="none">
              <div className="px-[22px] pt-[18px] pb-3.5">
                <div className="text-[14px] font-semibold tracking-tight">Plan de pagos</div>
                <div className="text-[12px] text-[var(--color-text-muted)] mt-0.5">
                  Informativo — los montos reales pueden variar según los pagos efectivos.
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px] tabular">
                  <thead>
                    <tr className="border-t border-[var(--color-border)] bg-[var(--color-surface-alt)]">
                      {[
                        { name: 'Cuota', align: 'left' },
                        { name: 'Vencimiento', align: 'left' },
                        { name: 'Capital Plan', align: 'right' },
                        { name: 'Interés Plan', align: 'right' },
                        { name: 'Cuota Total', align: 'right' },
                        ...(loan.status === 'active' || loan.status === 'paid'
                          ? [
                              { name: 'Abono Capital', align: 'right' },
                              { name: 'Abono Interés', align: 'right' },
                              { name: 'Mora Interés', align: 'right' },
                            ]
                          : []),
                        { name: 'Saldo Capital', align: 'right' },
                      ].map((h) => (
                        <th
                          key={h.name}
                          className={`px-4 py-2.5 text-[10px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase ${
                            h.align === 'right' ? 'text-right' : 'text-left'
                          }`}
                        >
                          {h.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loanBook.months.map((row) => {
                      const showPayments = loan.status === 'active' || loan.status === 'paid';
                      const hasDebt = row.interest_debt > 0;
                      return (
                        <tr key={row.month_number} className="border-t border-[var(--color-border)]">
                          <td className="px-4 py-3 text-[var(--color-text-muted)] font-semibold text-left">
                            #{row.month_number}
                          </td>
                          <td className="px-4 py-3 text-[var(--color-text-muted)] text-left">
                            {new Date(row.due_date + 'T12:00:00').toLocaleDateString('es-CO', {
                              month: 'short',
                              year: 'numeric',
                            })}
                          </td>
                          <td className="px-4 py-3 font-semibold text-right">
                            {row.plan_capital > 0 ? cop(row.plan_capital) : '—'}
                          </td>
                          <td className="px-4 py-3 text-[var(--color-text-muted)] text-right">
                            {row.plan_interest > 0 ? cop(row.plan_interest) : '—'}
                          </td>
                          <td className="px-4 py-3 font-semibold text-right">
                            {row.installment_value > 0 ? cop(row.installment_value) : '—'}
                          </td>
                          {showPayments && (
                            <>
                              <td className="px-4 py-3 text-[var(--color-success)] text-right">
                                {row.paid_capital > 0 ? cop(row.paid_capital) : '—'}
                              </td>
                              <td className="px-4 py-3 text-[var(--color-success)] text-right">
                                {row.paid_interest > 0 ? cop(row.paid_interest) : '—'}
                              </td>
                              <td
                                className={`px-4 py-3 text-right ${
                                  hasDebt ? 'text-[var(--color-danger)] font-semibold' : 'text-[var(--color-text-subtle)]'
                                }`}
                              >
                                {hasDebt ? cop(row.interest_debt) : '—'}
                              </td>
                            </>
                          )}
                          <td className="px-4 py-3 text-right font-semibold">
                            {cop(row.capital_balance_after)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-[var(--color-surface-alt)]/60 text-[11px] font-semibold border-t border-[var(--color-border)]">
                    <tr>
                      <td colSpan={2} className="px-4 py-3 text-left">
                        Totales
                      </td>
                      <td className="px-4 py-3 text-right text-[var(--color-text-muted)]">
                        {cop(loanBook.months.reduce((s, r) => s + r.plan_capital, 0))}
                      </td>
                      <td className="px-4 py-3 text-right text-[var(--color-text-muted)]">
                        {cop(loanBook.months.reduce((s, r) => s + r.plan_interest, 0))}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">
                        {cop(loanBook.months.reduce((s, r) => s + r.installment_value, 0))}
                      </td>
                      {/* Si se muestran los pagos, agregamos los totales de los abonos */}
                      {(loan.status === 'active' || loan.status === 'paid') && (
                        <>
                          <td className="px-4 py-3 text-right text-[var(--color-success)] font-semibold">
                            {cop(loanBook.summary.total_paid_capital)}
                          </td>
                          <td className="px-4 py-3 text-right text-[var(--color-success)] font-semibold">
                            {cop(loanBook.summary.total_paid_interest)}
                          </td>
                          <td
                            className={`px-4 py-3 text-right font-semibold ${
                              loanBook.summary.overdue_interest_debt > 0 ? 'text-[var(--color-danger)]' : ''
                            }`}
                          >
                            {loanBook.summary.overdue_interest_debt > 0 ? cop(loanBook.summary.overdue_interest_debt) : '—'}
                          </td>
                        </>
                      )}
                      <td className="px-4 py-3 text-right font-bold">
                        {cop(loanBook.summary.current_capital_balance)}
                      </td>
                    </tr>
                  </tfoot>
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

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' | 'danger' | 'success' }) {
  const valueClass =
    tone === 'danger'
      ? 'text-[var(--color-danger)]'
      : tone === 'warn'
        ? 'text-[var(--color-warn)]'
        : tone === 'success'
          ? 'text-[var(--color-success)]'
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
