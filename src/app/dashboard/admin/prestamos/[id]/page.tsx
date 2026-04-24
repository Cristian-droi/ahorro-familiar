'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { showToast } from '@/components/ui/Toast';
import {
  ChevronLeft,
  CheckCircle2,
  XCircle,
  Send,
  Banknote,
  AlertTriangle,
  Users,
  ThumbsUp,
  ThumbsDown,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { getLoanWithDetails } from '@/lib/data/loans';
import type { LoanWithDetails } from '@/types/entities';
import { cop } from '@/lib/format';
import {
  LOAN_STATUS_LABELS,
  LOAN_STATUS_TONE,
  calcAccruedInterest,
  requiredVotes,
} from '@/lib/loans';

export default function AdminLoanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [loan, setLoan] = useState<LoanWithDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [rejectionReason, setRejectionReason] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    const data = await getLoanWithDetails(supabase, id);
    setLoan(data);
    if (data?.admin_notes) setAdminNotes(data.admin_notes);
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  const call = async (path: string, method: string, body?: object) => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/prestamos/${id}/${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json();
      if (!res.ok) {
        showToast('error', json?.error ?? 'Ocurrió un error');
        return false;
      }
      await load();
      return true;
    } catch {
      showToast('error', 'Error de conexión');
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const approvePlan = () =>
    call('review', 'POST', { action: 'approve', admin_notes: adminNotes || undefined });

  const rejectPlan = () => {
    if (!rejectionReason.trim()) {
      showToast('error', 'Ingresá un motivo de rechazo');
      return;
    }
    call('review', 'POST', { action: 'reject', rejection_reason: rejectionReason, admin_notes: adminNotes || undefined });
  };

  const sendToVote = () => call('send-to-vote', 'POST');

  const disburse = async () => {
    const ok = await call('disburse', 'POST');
    if (ok) showToast('success', 'Préstamo desembolsado y activo.');
  };

  const toggleUpfront = (value: boolean) =>
    call('toggle-upfront-shares', 'PATCH', { loan_shares_paid_upfront: value });

  if (loading) return <div className="animate-pulse text-[var(--color-text-subtle)] text-sm">Cargando…</div>;
  if (!loan) return <div className="text-sm text-[var(--color-text-muted)]">Préstamo no encontrado.</div>;

  const tone = LOAN_STATUS_TONE[loan.status] as Parameters<typeof Badge>[0]['tone'];
  const needed = requiredVotes(loan.total_active_shareholders);

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
        <Link href="/dashboard/admin/prestamos">
          <Button variant="secondary" size="sm">
            <ChevronLeft size={15} strokeWidth={1.75} /> Volver
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-[22px] font-semibold tracking-[-0.025em]">
              {loan.borrower ? `${loan.borrower.first_name} ${loan.borrower.last_name}` : 'Accionista'} — {cop(Number(loan.requested_amount))}
            </h1>
            <Badge tone={tone}>{LOAN_STATUS_LABELS[loan.status]}</Badge>
          </div>
          <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
            Solicitado el {new Date(loan.created_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6 items-start">
        {/* Columna principal */}
        <div className="flex flex-col gap-5">
          {/* Detalles */}
          <Card padding="lg">
            <h2 className="text-[14px] font-semibold tracking-tight mb-4">Términos del préstamo</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <Stat label="Monto solicitado" value={cop(Number(loan.requested_amount))} />
              <Stat label="Tasa mensual" value={`${Number(loan.interest_rate) * 100}%`} />
              <Stat label="Plazo" value={`${loan.payment_plan_months ?? '—'} meses`} />
              <Stat
                label={`Acciones por préstamo (${loan.loan_shares_count})`}
                value={cop(Number(loan.loan_shares_amount))}
              />
              <Stat label="Retención 4×1000" value={cop(Number(loan.four_per_thousand))} />
              <Stat
                label="Modalidad acciones"
                value={loan.loan_shares_paid_upfront ? 'Paga por adelantado' : 'Descuento al desembolso'}
              />
              {loan.disbursed_at && (
                <Stat label="Desembolsado el" value={new Date(loan.disbursed_at).toLocaleDateString('es-CO')} />
              )}
              {loan.disbursed_amount != null && (
                <Stat label="Monto desembolsado" value={cop(Number(loan.disbursed_amount))} />
              )}
              {loan.status === 'active' && (
                <>
                  <Stat label="Saldo pendiente" value={cop(Number(loan.outstanding_balance))} tone="warn" />
                  <Stat label="Intereses acumulados" value={cop(accruedInterest)} tone="danger" />
                </>
              )}
            </div>

            {loan.admin_notes && (
              <div className="mt-4 p-3 rounded-[10px] bg-[var(--color-surface-alt)] text-[13px] text-[var(--color-text-muted)]">
                <b className="text-[var(--color-text)]">Notas internas:</b> {loan.admin_notes}
              </div>
            )}
          </Card>

          {/* Plan de pagos */}
          {loan.payment_plan.length > 0 && (
            <Card padding="none">
              <div className="px-[22px] pt-[18px] pb-3.5 flex items-center justify-between">
                <div>
                  <div className="text-[14px] font-semibold tracking-tight">Plan de pagos propuesto</div>
                  <div className="text-[12px] text-[var(--color-text-muted)] mt-0.5">
                    {loan.plan_status === 'approved' && '✓ Plan aprobado'}
                    {loan.plan_status === 'rejected' && `✗ Plan rechazado: ${loan.plan_rejection_reason}`}
                    {!loan.plan_status && 'Pendiente de revisión'}
                  </div>
                </div>
                {loan.plan_status && (
                  <Badge tone={loan.plan_status === 'approved' ? 'success' : 'danger'}>
                    {loan.plan_status === 'approved' ? 'Aprobado' : 'Rechazado'}
                  </Badge>
                )}
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

          {/* Votos */}
          {loan.votes.length > 0 && (
            <Card padding="lg">
              <div className="flex items-center gap-2 mb-4">
                <Users size={16} strokeWidth={1.75} className="text-[var(--color-text-muted)]" />
                <div className="text-[14px] font-semibold tracking-tight">
                  Votación ({loan.approved_votes} a favor · {loan.rejected_votes} en contra · necesarios: {needed})
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {loan.votes.map((v) => {
                  const voter = v as typeof v & { voter?: { first_name: string; last_name: string } };
                  return (
                    <div key={v.id} className="flex items-center gap-3 text-[13px]">
                      {v.vote === 'approved' ? (
                        <ThumbsUp size={14} strokeWidth={1.75} className="text-[var(--color-success)]" />
                      ) : (
                        <ThumbsDown size={14} strokeWidth={1.75} className="text-[var(--color-danger)]" />
                      )}
                      <span className="font-medium">
                        {voter.voter ? `${voter.voter.first_name} ${voter.voter.last_name}` : v.voter_id}
                      </span>
                      {v.comment && (
                        <span className="text-[var(--color-text-muted)]">— {v.comment}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>

        {/* Acciones del admin */}
        <div className="flex flex-col gap-4">
          {/* Revisión del plan */}
          {loan.status === 'pending_review' && (
            <Card padding="lg">
              <div className="text-[14px] font-semibold tracking-tight mb-4">Revisar solicitud</div>

              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-[10px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase block mb-1.5">
                    Notas internas (opcional)
                  </label>
                  <textarea
                    value={adminNotes}
                    onChange={(e) => setAdminNotes(e.target.value)}
                    rows={2}
                    placeholder="Observaciones para referencia interna..."
                    className="w-full rounded-[9px] bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2 text-[13px] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-brand)] resize-none"
                  />
                </div>

                <Button size="md" className="w-full" disabled={submitting} onClick={approvePlan}>
                  <CheckCircle2 size={15} strokeWidth={1.75} />
                  Aprobar plan de pagos
                </Button>

                <div className="h-px bg-[var(--color-border)]" />

                <div>
                  <label className="text-[10px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase block mb-1.5">
                    Motivo de rechazo
                  </label>
                  <textarea
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    rows={2}
                    placeholder="Explicá por qué se rechaza el plan..."
                    className="w-full rounded-[9px] bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2 text-[13px] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-danger)] resize-none"
                  />
                </div>
                <Button variant="secondary" size="md" className="w-full" disabled={submitting} onClick={rejectPlan}>
                  <XCircle size={15} strokeWidth={1.75} />
                  Rechazar solicitud
                </Button>
              </div>
            </Card>
          )}

          {/* Enviar a votación (una vez aprobado el plan) */}
          {loan.status === 'pending_review' && loan.plan_status === 'approved' && (
            <Card padding="lg" className="border-[var(--color-brand)]/25">
              <div className="text-[14px] font-semibold tracking-tight mb-2">Plan aprobado</div>
              <p className="text-[12px] text-[var(--color-text-muted)] mb-4">
                El plan fue aprobado. Envialo a votación cuando estés listo.
              </p>
              <Button size="md" className="w-full" disabled={submitting} onClick={sendToVote}>
                <Send size={15} strokeWidth={1.75} />
                Enviar a votación
              </Button>
            </Card>
          )}

          {/* Desembolso */}
          {loan.status === 'pending_disbursement' && (
            <Card padding="lg" className="border-[var(--color-success)]/25">
              <div className="text-[14px] font-semibold tracking-tight mb-2">Listo para desembolso</div>

              <div className="flex flex-col gap-2 text-[13px] mb-4">
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">Monto solicitado</span>
                  <span className="font-semibold tabular">{cop(Number(loan.requested_amount))}</span>
                </div>
                {!loan.loan_shares_paid_upfront && (
                  <div className="flex justify-between text-[var(--color-danger)]">
                    <span>Acciones por préstamo ({loan.loan_shares_count})</span>
                    <span className="font-semibold tabular">− {cop(Number(loan.loan_shares_amount))}</span>
                  </div>
                )}
                <div className="flex justify-between text-[var(--color-danger)]">
                  <span className="text-[var(--color-text-muted)]">Retención 4×1000</span>
                  <span className="font-semibold tabular">− {cop(Number(loan.four_per_thousand))}</span>
                </div>
                <div className="h-px bg-[var(--color-border)]" />
                <div className="flex justify-between">
                  <span className="font-semibold">El accionista recibirá</span>
                  <span className="font-semibold tabular text-[var(--color-success)]">
                    {cop(
                      Number(loan.requested_amount) -
                        (loan.loan_shares_paid_upfront ? 0 : Number(loan.loan_shares_amount)) -
                        Number(loan.four_per_thousand),
                    )}
                  </span>
                </div>
              </div>

              {/* Toggle acciones por adelantado */}
              <div className="mb-4 p-3 rounded-[10px] bg-[var(--color-surface-alt)]">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[12px]">
                    <div className="font-semibold">Acciones por préstamo</div>
                    <div className="text-[var(--color-text-muted)]">
                      {loan.loan_shares_paid_upfront ? 'El accionista las pagará por adelantado' : 'Se descontarán del desembolso'}
                    </div>
                  </div>
                  <button
                    onClick={() => toggleUpfront(!loan.loan_shares_paid_upfront)}
                    className="text-[var(--color-brand)] hover:opacity-70 transition-opacity"
                    title="Cambiar modalidad"
                    disabled={submitting}
                  >
                    {loan.loan_shares_paid_upfront ? (
                      <ToggleRight size={28} strokeWidth={1.5} />
                    ) : (
                      <ToggleLeft size={28} strokeWidth={1.5} />
                    )}
                  </button>
                </div>

                {loan.loan_shares_paid_upfront && !loan.has_upfront_shares_receipt && (
                  <div className="mt-2 flex items-start gap-2 text-[11px] text-[var(--color-warn)]">
                    <AlertTriangle size={12} strokeWidth={2} className="mt-px shrink-0" />
                    Esperando que el accionista compre y el recibo de acciones por préstamo sea aprobado.
                  </div>
                )}

                {loan.loan_shares_paid_upfront && loan.has_upfront_shares_receipt && (
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-[var(--color-success)]">
                    <CheckCircle2 size={12} strokeWidth={2} />
                    Acciones por préstamo pagadas ✓
                  </div>
                )}
              </div>

              <Button
                size="md"
                className="w-full"
                disabled={submitting || (loan.loan_shares_paid_upfront && !loan.has_upfront_shares_receipt)}
                onClick={disburse}
              >
                <Banknote size={15} strokeWidth={1.75} />
                Confirmar desembolso
              </Button>
            </Card>
          )}

          {/* Estado informativo para otros estados */}
          {['active', 'paid', 'rejected_by_admin', 'rejected_by_shareholders', 'draft', 'pending_shareholder_vote'].includes(loan.status) && (
            <Card padding="lg">
              <div className="text-[14px] font-semibold tracking-tight mb-2">Estado</div>
              <Badge tone={tone}>{LOAN_STATUS_LABELS[loan.status]}</Badge>
              {loan.rejection_reason && (
                <div className="mt-3 text-[12px] text-[var(--color-text-muted)]">
                  Motivo: {loan.rejection_reason}
                </div>
              )}
              {loan.status === 'pending_shareholder_vote' && (
                <div className="mt-3 text-[12px] text-[var(--color-text-muted)]">
                  {loan.approved_votes} / {needed} votos necesarios · {loan.total_active_shareholders} accionistas activos
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
    tone === 'danger' ? 'text-[var(--color-danger)]' : tone === 'warn' ? 'text-[var(--color-warn)]' : 'text-[var(--color-text)]';
  return (
    <div>
      <div className="text-[10px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase mb-1">{label}</div>
      <div className={`text-[15px] font-semibold tabular ${valueClass}`}>{value}</div>
    </div>
  );
}
