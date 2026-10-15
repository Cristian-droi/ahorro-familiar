'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { showToast } from '@/components/ui/Toast';
import {
  Info,
  AlertTriangle,
  ChevronRight,
  Pencil,
  Check,
  X,
} from 'lucide-react';
import { getProfile } from '@/lib/data/profiles';
import { getCashBalance } from '@/lib/data/loans';
import { cop } from '@/lib/format';
import {
  calcLoanShares,
  calcFourPerThousand,
  calcDisbursedAmount,
  calcLoanDeductionsAndNet,
  buildPaymentPlan,
  type PlanRow,
} from '@/lib/loans';
import { checkUserObligations, type UserObligationsStatus } from '@/lib/obligations';
import { DeductionDetail } from '@/types/entities';

export default function NuevaSolicitudPage() {
  const router = useRouter();

  const [shareValue, setShareValue] = useState<number | null>(null);
  const [interestRate, setInterestRate] = useState(0.02);
  const [cashBalance, setCashBalance] = useState<number | null>(null);
  const [obligations, setObligations] = useState<UserObligationsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [amountInput, setAmountInput] = useState('');
  const [months, setMonths] = useState(12);
  const [paidUpfront, setPaidUpfront] = useState(false);
  const [deductObligations, setDeductObligations] = useState(false);
  const [capitalAbonos, setCapitalAbonos] = useState<Record<string, number>>({});

  const [capitalOverrides, setCapitalOverrides] = useState<Record<number, number>>({});
  const [editingMonth, setEditingMonth] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/login'); return; }

      const [profile, rateSetting, balance, obligationsStatus] = await Promise.all([
        getProfile(supabase, user.id),
        supabase.from('system_settings').select('value').eq('key', 'loan_interest_rate').maybeSingle(),
        getCashBalance(supabase).catch(() => null),
        checkUserObligations(supabase, user.id).catch(() => null),
      ]);

      if (cancelled) return;
      setShareValue(profile.selected_share_value ?? null);
      if (rateSetting.data?.value) setInterestRate(Number(rateSetting.data.value));
      setCashBalance(balance);
      setObligations(obligationsStatus);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [router]);

  const requestedAmount = useMemo(() => {
    const digits = amountInput.replace(/[^\d]/g, '');
    return digits ? Number(digits) : 0;
  }, [amountInput]);

  const { count: sharesCount, amount: sharesAmount } = useMemo(
    () => (shareValue ? calcLoanShares(requestedAmount, shareValue) : { count: 0, amount: 0 }),
    [requestedAmount, shareValue],
  );

  const deductedShares = useMemo(() => {
    return deductObligations && obligations ? obligations.sharesOwedAmount : 0;
  }, [deductObligations, obligations]);

  const deductedFines = useMemo(() => {
    return deductObligations && obligations ? obligations.finesOwedAmount : 0;
  }, [deductObligations, obligations]);

  const deductedInterest = useMemo(() => {
    return deductObligations && obligations ? obligations.interestOwedAmount : 0;
  }, [deductObligations, obligations]);

  const deductedCapital = useMemo(() => {
    if (!deductObligations) return 0;
    return Object.values(capitalAbonos).reduce((sum, val) => sum + val, 0);
  }, [deductObligations, capitalAbonos]);

  const { netDisbursed, finalFourPerThousand } = useMemo(() => {
    if (deductObligations) {
      const { netDisbursed, fourPerThousand } = calcLoanDeductionsAndNet({
        requestedAmount,
        sharesAmount,
        paidUpfront,
        deductedShares,
        deductedFines,
        deductedInterest,
        deductedCapital,
      });
      return { netDisbursed, finalFourPerThousand: fourPerThousand };
    } else {
      const ft = calcFourPerThousand(requestedAmount);
      const nd = calcDisbursedAmount(requestedAmount, sharesAmount, paidUpfront, ft);
      return { netDisbursed: nd, finalFourPerThousand: ft };
    }
  }, [
    requestedAmount,
    sharesAmount,
    paidUpfront,
    deductObligations,
    deductedShares,
    deductedFines,
    deductedInterest,
    deductedCapital,
  ]);

  const plan: PlanRow[] = useMemo(() => {
    if (requestedAmount < 500_000 || months < 1) return [];
    return buildPaymentPlan({
      requestedAmount,
      months,
      rate: interestRate,
      disbursedAt: new Date(),
      capitalOverrides,
    });
  }, [requestedAmount, months, interestRate, capitalOverrides]);

  const exceedsCashBalance = cashBalance !== null && requestedAmount > cashBalance && requestedAmount > 0;

  const validationError = useMemo(() => {
    if (requestedAmount < 500_000) return 'El monto mínimo es $500.000';
    if (!shareValue) return 'Debes definir tu valor de acción en Ajustes';
    if (months < 1 || months > 60) return 'Los meses deben estar entre 1 y 60';
    if (deductObligations && netDisbursed < 0) {
      return 'Las deducciones no pueden superar el monto solicitado.';
    }
    return null;
  }, [requestedAmount, shareValue, months, deductObligations, netDisbursed]);

  const canSubmit = useMemo(() => {
    if (submitting || !!validationError || requestedAmount === 0) return false;
    if (obligations?.isUpToDate) return true;
    return deductObligations;
  }, [submitting, validationError, requestedAmount, obligations, deductObligations]);

  const startEdit = (row: PlanRow) => {
    setEditingMonth(row.month_number);
    setEditingValue(String(row.capital_amount));
  };

  const commitEdit = useCallback(
    (monthNumber: number) => {
      const val = Number(editingValue.replace(/[^\d]/g, ''));
      if (!isNaN(val) && val >= 0) {
        setCapitalOverrides((prev) => ({ ...prev, [monthNumber]: val }));
      }
      setEditingMonth(null);
    },
    [editingValue],
  );

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const detail: DeductionDetail[] = [];
      if (deductObligations && obligations) {
        const today = new Date();
        const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;

        // Acciones y multas
        for (const o of obligations.overdueMonthsDetails) {
          if (o.sharesOwed > 0) {
            detail.push({
              concept: 'acciones',
              target_month: o.month,
              share_count: o.sharesOwed,
              unit_value: o.shareValue,
              amount: o.sharesOwed * o.shareValue,
            });
          }
          if (o.fineOwed > 0) {
            detail.push({
              concept: 'multa_acciones',
              target_month: o.month,
              amount: o.fineOwed,
            });
          }
        }

        // Intereses
        for (const l of obligations.activeLoansDetails) {
          if (l.interestOwed > 0) {
            detail.push({
              concept: 'pago_intereses',
              target_month: currentMonthStr,
              amount: l.interestOwed,
              loan_id: l.loanId,
              disbursementNumber: l.disbursementNumber,
            });
          }
        }

        // Capital
        for (const [loanId, amount] of Object.entries(capitalAbonos)) {
          if (amount > 0) {
            const l = obligations.activeLoansDetails.find(active => active.loanId === loanId);
            detail.push({
              concept: 'pago_capital',
              target_month: currentMonthStr,
              amount,
              loan_id: loanId,
              disbursementNumber: l?.disbursementNumber ?? null,
            });
          }
        }
      }

      const res = await fetch('/api/prestamos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requested_amount: requestedAmount,
          payment_plan_months: months,
          loan_shares_paid_upfront: paidUpfront,
          deduct_obligations: deductObligations,
          deducted_capital_amount: deductedCapital,
          deductions_detail: detail,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast('error', json?.error ?? 'No se pudo crear la solicitud');
        setSubmitting(false);
        return;
      }

      if (Object.keys(capitalOverrides).length > 0) {
        await fetch(`/api/prestamos/${json.loan.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ months, capital_overrides: capitalOverrides }),
        });
      }

      await fetch(`/api/prestamos/${json.loan.id}/submit`, { method: 'POST' });

      showToast('success', 'Solicitud enviada. El administrador la revisará pronto.');
      router.push('/dashboard/prestamos');
    } catch {
      showToast('error', 'Error al enviar la solicitud');
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="animate-pulse text-[var(--color-text-subtle)] text-sm">Cargando…</div>;
  }

  return (
    <div className="flex flex-col gap-7 animate-in fade-in duration-300">
      <header>
        <h1 className="text-[26px] font-semibold tracking-[-0.025em] leading-[1.15]">
          Nueva solicitud de préstamo
        </h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1.5">
          Simulá el préstamo y editá el plan de pagos antes de enviarlo.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
        {/* Columna principal */}
        <div className="flex flex-col gap-5">
          {/* Alerta de obligaciones pendientes */}
          {obligations && !obligations.isUpToDate && (
            <div className="p-4 rounded-[10px] bg-[var(--color-danger-soft)] border border-[var(--color-danger)]/30 text-[var(--color-danger)] flex flex-col gap-2">
              <div className="flex items-center gap-2 font-semibold text-[14px]">
                <AlertTriangle size={16} strokeWidth={2} className="shrink-0" />
                No podés solicitar un préstamo porque tenés obligaciones pendientes:
              </div>
              <ul className="list-disc pl-5 text-[13px] flex flex-col gap-1">
                {obligations.reasons.map((reason, idx) => (
                  <li key={idx}>{reason}</li>
                ))}
              </ul>
              <p className="text-[12px] opacity-90 mt-1">
                {deductObligations 
                  ? 'Como seleccionaste la opción de descuento, podés enviar la solicitud y estas deudas se descontarán de tu desembolso.'
                  : 'Por favor, ponete al día en el módulo correspondiente o selecciona la opción para descontar deudas del monto del préstamo.'}
              </p>
            </div>
          )}

          {/* Monto y meses */}
          <Card padding="lg">
            <h2 className="text-[15px] font-semibold tracking-tight mb-4">Detalles del préstamo</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase block mb-1.5">
                  Monto solicitado (COP)
                </label>
                <div className="flex items-center h-10 rounded-[9px] bg-[var(--color-surface)] border border-[var(--color-border)] px-3">
                  <span className="text-[13px] text-[var(--color-text-subtle)] mr-1.5">$</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Ej. 2.000.000"
                    value={amountInput}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/[^\d]/g, '');
                      setAmountInput(digits ? new Intl.NumberFormat('es-CO').format(Number(digits)) : '');
                      setCapitalOverrides({});
                    }}
                    className="flex-1 bg-transparent text-[14px] font-semibold text-[var(--color-text)] focus:outline-none tabular"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase block mb-1.5">
                  Plazo (meses)
                </label>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={months}
                  onChange={(e) => {
                    const v = Math.max(1, Math.min(60, Number(e.target.value)));
                    setMonths(v);
                    setCapitalOverrides({});
                  }}
                  className="w-full h-10 rounded-[9px] bg-[var(--color-surface)] border border-[var(--color-border)] px-3 text-[14px] font-semibold text-[var(--color-text)] focus:outline-none focus:border-[var(--color-brand)]"
                />
              </div>
            </div>

            {/* Advertencia: supera saldo en caja */}
            {exceedsCashBalance && (
              <div className="mt-4 flex items-start gap-2.5 p-3.5 rounded-[10px] bg-[var(--color-warn-soft)] border border-[var(--color-warn)]/30">
                <AlertTriangle size={14} strokeWidth={2} className="text-[var(--color-warn)] mt-px shrink-0" />
                <div className="text-[12px]">
                  <span className="font-semibold text-[var(--color-warn)]">El monto supera el saldo disponible en caja</span>
                  <span className="text-[var(--color-text-muted)]"> ({cop(cashBalance!)} disponibles). Podés igualmente enviar la solicitud — el administrador evaluará la disponibilidad.</span>
                </div>
              </div>
            )}

            {/* Opción pagar acciones por adelantado */}
            {sharesCount > 0 && (
              <div
                className={`mt-4 flex items-start gap-3 p-3.5 rounded-[10px] border cursor-pointer transition-colors ${
                  paidUpfront
                    ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface-alt)]'
                }`}
                onClick={() => setPaidUpfront((p) => !p)}
              >
                <div
                  className={`w-5 h-5 rounded-[5px] border-2 flex items-center justify-center shrink-0 mt-px transition-colors ${
                    paidUpfront
                      ? 'bg-[var(--color-brand)] border-[var(--color-brand)]'
                      : 'border-[var(--color-border)]'
                  }`}
                >
                  {paidUpfront && <Check size={12} strokeWidth={2.5} className="text-white" />}
                </div>
                <div>
                  <div className="text-[13px] font-semibold">
                    Quiero pagar las {sharesCount} acciones por préstamo ({cop(sharesAmount)}) por adelantado
                  </div>
                  <div className="text-[12px] text-[var(--color-text-muted)] mt-0.5">
                    Si marcás esta opción, recibirás {cop(calcDisbursedAmount(requestedAmount, sharesAmount, true, finalFourPerThousand))} en vez de {cop(calcDisbursedAmount(requestedAmount, sharesAmount, false, finalFourPerThousand))}.
                    Deberás comprarlas en el módulo de compras antes del desembolso.
                  </div>
                </div>
              </div>
            )}

            {/* Opción de descuento de obligaciones y abono a capital */}
            {obligations && (!obligations.isUpToDate || obligations.activeLoansDetails.some(l => l.outstandingBalance > 0)) && (
              <div
                className={`mt-4 flex items-start gap-3 p-3.5 rounded-[10px] border cursor-pointer transition-colors ${
                  deductObligations
                    ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface-alt)]'
                }`}
                onClick={() => setDeductObligations((d) => !d)}
              >
                <div
                  className={`w-5 h-5 rounded-[5px] border-2 flex items-center justify-center shrink-0 mt-px transition-colors ${
                    deductObligations
                      ? 'bg-[var(--color-brand)] border-[var(--color-brand)]'
                      : 'border-[var(--color-border)]'
                  }`}
                >
                  {deductObligations && <Check size={12} strokeWidth={2.5} className="text-white" />}
                </div>
                <div>
                  <div className="text-[13px] font-semibold">
                    ¿Querés descontar tus deudas y/o abonar a capital de préstamos activos del monto de este préstamo?
                  </div>
                  <div className="text-[12px] text-[var(--color-text-muted)] mt-0.5">
                    Permite saldar tus deudas actuales de acciones, multas e intereses, o realizar abonos a capital a tus préstamos activos, descontándolo directamente del desembolso de esta solicitud.
                  </div>
                </div>
              </div>
            )}
          </Card>

          {/* Desglose de deducciones si la opción está activa */}
          {deductObligations && obligations && (
            <Card padding="lg" className="flex flex-col gap-4">
              <h3 className="text-[15px] font-semibold tracking-tight text-[var(--color-text)]">
                Detalle de deudas a descontar
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Tarjeta de Acciones vencidas */}
                <div className="p-4 rounded-[10px] bg-[var(--color-surface-alt)] border border-[var(--color-border)] flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-[var(--color-text-subtle)] uppercase tracking-wider">Acciones en mora</span>
                  <span className="text-lg font-bold tabular text-[var(--color-text)]">
                    {cop(obligations.sharesOwedAmount)}
                  </span>
                  <span className="text-[11px] text-[var(--color-text-muted)]">
                    {obligations.sharesOwedCount > 0 ? `${obligations.sharesOwedCount} acción(es) pendiente(s)` : 'Al día'}
                  </span>
                </div>

                {/* Tarjeta de Multas */}
                <div className="p-4 rounded-[10px] bg-[var(--color-surface-alt)] border border-[var(--color-border)] flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-[var(--color-text-subtle)] uppercase tracking-wider">Multas por mora</span>
                  <span className="text-lg font-bold tabular text-[var(--color-text)]">
                    {cop(obligations.finesOwedAmount)}
                  </span>
                  <span className="text-[11px] text-[var(--color-text-muted)]">
                    {obligations.finesOwedAmount > 0 ? 'Faltas en el año' : 'Sin multas'}
                  </span>
                </div>

                {/* Tarjeta de Intereses */}
                <div className="p-4 rounded-[10px] bg-[var(--color-surface-alt)] border border-[var(--color-border)] flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-[var(--color-text-subtle)] uppercase tracking-wider">Intereses de préstamos</span>
                  <span className="text-lg font-bold tabular text-[var(--color-text)]">
                    {cop(obligations.interestOwedAmount)}
                  </span>
                  <span className="text-[11px] text-[var(--color-text-muted)]">
                    {obligations.interestOwedAmount > 0 ? 'Préstamos activos' : 'Al día'}
                  </span>
                </div>
              </div>

              {/* Sección de Abonos a Capital */}
              {obligations.activeLoansDetails.some(l => l.outstandingBalance > 0) && (
                <div className="flex flex-col gap-3 mt-2 border-t border-[var(--color-border)] pt-4">
                  <div>
                    <h4 className="text-[13px] font-semibold text-[var(--color-text)]">
                      Abonar a capital de préstamos activos
                    </h4>
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                      Ingresá cuánto querés destinar al saldo de capital de cada préstamo activo.
                    </p>
                  </div>
                  
                  <div className="flex flex-col gap-3">
                    {obligations.activeLoansDetails
                      .filter(l => l.outstandingBalance > 0)
                      .map((loan) => (
                        <div key={loan.loanId} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-[9px] bg-[var(--color-surface)] border border-[var(--color-border)]">
                          <div>
                            <span className="text-[13px] font-semibold text-[var(--color-text)]">
                              Préstamo #{loan.disbursementNumber || loan.loanId.slice(0, 8)}
                            </span>
                            <div className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                              Saldo capital: {cop(loan.outstandingBalance)}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] text-[var(--color-text-subtle)] font-medium">$</span>
                            <input
                              type="text"
                              inputMode="numeric"
                              placeholder="Ej. 100.000"
                              value={
                                capitalAbonos[loan.loanId] !== undefined
                                  ? new Intl.NumberFormat('es-CO').format(capitalAbonos[loan.loanId])
                                  : ''
                              }
                              onChange={(e) => {
                                const digits = e.target.value.replace(/[^\d]/g, '');
                                const numericValue = digits ? Number(digits) : 0;
                                const validValue = Math.min(numericValue, loan.outstandingBalance);
                                setCapitalAbonos((prev) => ({
                                  ...prev,
                                  [loan.loanId]: validValue,
                                }));
                              }}
                              className="w-32 h-9 rounded-[8px] bg-[var(--color-surface-alt)] border border-[var(--color-border)] px-2.5 text-right text-[13px] font-semibold text-[var(--color-text)] focus:outline-none focus:border-[var(--color-brand)] tabular"
                            />
                            {capitalAbonos[loan.loanId] > 0 && (
                              <button
                                onClick={() => {
                                  setCapitalAbonos((prev) => {
                                    const copy = { ...prev };
                                    delete copy[loan.loanId];
                                    return copy;
                                  });
                                }}
                                className="text-[var(--color-danger)] hover:opacity-75"
                              >
                                <X size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </Card>
          )}

          {/* Tabla del plan de pagos */}
          {plan.length > 0 && (
            <Card padding="none">
              <div className="px-[22px] pt-[18px] pb-3.5 flex items-center justify-between">
                <div>
                  <h2 className="text-[15px] font-semibold tracking-tight">Plan de pagos</h2>
                  <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5">
                    Podés editar el capital de cada cuota. Las cuotas sin asignación se ajustan a cero.
                  </p>
                </div>
                <Badge tone="info">{interestRate * 100}% mensual</Badge>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-t border-[var(--color-border)] bg-[var(--color-surface-alt)]">
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase">Cuota</th>
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase">Mes</th>
                      <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase">Capital</th>
                      <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase">Intereses</th>
                      <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase">Saldo</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {plan.map((row) => (
                      <tr
                        key={row.month_number}
                        className="border-t border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]/50"
                      >
                        <td className="px-4 py-3 font-semibold text-[var(--color-text-muted)]">
                          #{row.month_number}
                        </td>
                        <td className="px-4 py-3 text-[var(--color-text-muted)]">
                          {new Date(row.due_date + 'T12:00:00').toLocaleDateString('es-CO', { month: 'short', year: 'numeric' })}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold tabular">
                          {editingMonth === row.month_number ? (
                            <div className="flex items-center justify-end gap-1">
                              <input
                                type="text"
                                inputMode="numeric"
                                value={editingValue}
                                onChange={(e) => setEditingValue(e.target.value.replace(/[^\d]/g, ''))}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') commitEdit(row.month_number);
                                  if (e.key === 'Escape') setEditingMonth(null);
                                }}
                                className="w-28 h-7 rounded-[6px] bg-[var(--color-surface)] border border-[var(--color-brand)] px-2 text-right text-[13px] font-semibold focus:outline-none tabular"
                                autoFocus
                              />
                              <button onClick={() => commitEdit(row.month_number)} className="text-[var(--color-success)] hover:opacity-70"><Check size={13} /></button>
                              <button onClick={() => setEditingMonth(null)} className="text-[var(--color-text-subtle)] hover:opacity-70"><X size={13} /></button>
                            </div>
                          ) : (
                            <span className={row.capital_amount === 0 ? 'text-[var(--color-text-subtle)]' : ''}>
                              {cop(row.capital_amount)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-[var(--color-text-muted)] tabular">
                          {cop(row.estimated_interest)}
                        </td>
                        <td className="px-4 py-3 text-right tabular">
                          {cop(row.estimated_balance_after)}
                        </td>
                        <td className="px-2 py-3 text-right">
                          {editingMonth !== row.month_number && (
                            <button
                              onClick={() => startEdit(row)}
                              className="text-[var(--color-text-subtle)] hover:text-[var(--color-brand)] transition-colors"
                              title="Editar capital"
                            >
                              <Pencil size={13} strokeWidth={1.75} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {Object.keys(capitalOverrides).length > 0 && (
                <div className="px-[22px] py-3 border-t border-[var(--color-border)]">
                  <button
                    onClick={() => setCapitalOverrides({})}
                    className="text-[12px] text-[var(--color-text-subtle)] hover:text-[var(--color-danger)] transition-colors"
                  >
                    Restablecer distribución uniforme
                  </button>
                </div>
              )}
            </Card>
          )}

          {validationError && (
            <div className="flex items-center gap-2 text-[13px] text-[var(--color-danger)]">
              <AlertTriangle size={14} strokeWidth={2} />
              {validationError}
            </div>
          )}
        </div>

        {/* Resumen lateral */}
        <aside className="lg:sticky lg:top-4">
          <Card padding="lg">
            <h2 className="text-[15px] font-semibold tracking-tight mb-4">Resumen</h2>

            <div className="flex flex-col gap-2.5 text-[13px]">
              {shareValue != null && (
                <Row label="Valor de tu acción" value={cop(shareValue)} />
              )}
              {cashBalance !== null && (
                <Row
                  label="Saldo en caja"
                  value={cop(cashBalance)}
                  tone={exceedsCashBalance ? 'danger' : undefined}
                />
              )}
              {(shareValue != null || cashBalance !== null) && (
                <div className="h-px bg-[var(--color-border)] my-0.5" />
              )}
              <Row label="Monto solicitado" value={cop(requestedAmount)} />
              <Row
                label={`Acciones por préstamo (${sharesCount})`}
                value={paidUpfront ? 'Pagarás por adelantado' : `− ${cop(sharesAmount)}`}
                tone={paidUpfront ? 'muted' : sharesAmount > 0 ? 'danger' : undefined}
              />

              {deductObligations && (
                <>
                  {deductedShares > 0 && (
                    <Row label="Acciones vencidas desc." value={`− ${cop(deductedShares)}`} tone="danger" />
                  )}
                  {deductedFines > 0 && (
                    <Row label="Multas desc." value={`− ${cop(deductedFines)}`} tone="danger" />
                  )}
                  {deductedInterest > 0 && (
                    <Row label="Intereses desc." value={`− ${cop(deductedInterest)}`} tone="danger" />
                  )}
                  {deductedCapital > 0 && (
                    <Row label="Abonos a capital" value={`− ${cop(deductedCapital)}`} tone="danger" />
                  )}
                </>
              )}

              <Row label="Retención 4×1000" value={`− ${cop(finalFourPerThousand)}`} tone="danger" />
              <div className="h-px bg-[var(--color-border)] my-1" />
              <div className="flex items-end justify-between">
                <span className="text-[12px] font-semibold text-[var(--color-text-muted)] tracking-wider uppercase">
                  Recibirás
                </span>
                <span className="text-[22px] font-semibold tracking-[-0.02em] tabular text-[var(--color-success)]">
                  {requestedAmount > 0 ? cop(netDisbursed) : '—'}
                </span>
              </div>
              <p className="text-[11px] text-[var(--color-text-subtle)] leading-snug">
                Intereses al {interestRate * 100}% mensual sobre {cop(requestedAmount)}.
              </p>
            </div>

            <Button
              variant="primary"
              size="lg"
              className="w-full mt-5"
              disabled={!canSubmit}
              onClick={handleSubmit}
            >
              {submitting ? 'Enviando…' : (
                <>
                  Enviar solicitud
                  <ChevronRight size={16} strokeWidth={1.75} />
                </>
              )}
            </Button>

            <div className="mt-3 flex items-start gap-2 text-[11px] text-[var(--color-text-subtle)] px-0.5">
              <Info size={12} strokeWidth={1.75} className="mt-px shrink-0" />
              <span>
                El plan de pagos es informativo. El administrador revisará tu solicitud antes de enviarla a votación.
              </span>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'danger' | 'muted';
}) {
  const valueClass =
    tone === 'danger'
      ? 'text-[var(--color-danger)]'
      : tone === 'muted'
        ? 'text-[var(--color-text-muted)]'
        : 'text-[var(--color-text)]';
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[var(--color-text-muted)]">{label}</span>
      <span className={`font-semibold tabular text-right ${valueClass}`}>{value}</span>
    </div>
  );
}
