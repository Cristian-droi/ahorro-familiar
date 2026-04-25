'use client';

// Libro de accionista — vista admin por accionista con sus préstamos.
//
// Para cada accionista con préstamos desembolsados muestra, por cada préstamo,
// una tabla mes a mes con:
//   - Cuota esperada (capital + interés plan)
//   - Capital pagado / Interés pagado
//   - Intereses en mora (interés plan − interés pagado, si positivo)
//   - Saldo de capital tras el mes
// Además calcula la próxima cuota (primer mes sin capital pagado completo) y
// un resumen por préstamo y por accionista.
//
// Seguridad: acceso protegido por role en el cliente y por RLS/requireAdmin
// en el backend — este componente solo lee y no muta.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { showToast } from '@/components/ui/Toast';
import { BookUser, ArrowRight, ChevronDown, ChevronUp, Search } from 'lucide-react';
import { getProfileRole } from '@/lib/data/profiles';
import {
  getLibroAccionistaData,
  type LibroAccionistaEntry,
  type LibroAccionistaLoan,
} from '@/lib/data/loans';
import { computeLoanBook, type LoanBook, LOAN_STATUS_LABELS } from '@/lib/loans';
import { cop, monthLabel } from '@/lib/format';

type BookedLoan = {
  source: LibroAccionistaLoan;
  book: LoanBook;
};

type BookedEntry = {
  user: LibroAccionistaEntry['user'];
  loans: BookedLoan[];
  totals: {
    requested: number;
    paid_capital: number;
    paid_interest: number;
    interest_debt: number;
    current_balance: number;
  };
};

function computeBookedEntries(entries: LibroAccionistaEntry[]): BookedEntry[] {
  return entries.map((e) => {
    const loans: BookedLoan[] = e.loans.map((l) => ({
      source: l,
      book: computeLoanBook({
        requestedAmount: Number(l.loan.requested_amount),
        plan: l.plan,
        payments: l.payments,
      }),
    }));
    const totals = loans.reduce(
      (acc, bl) => ({
        requested: acc.requested + bl.book.summary.requested_amount,
        paid_capital: acc.paid_capital + bl.book.summary.total_paid_capital,
        paid_interest: acc.paid_interest + bl.book.summary.total_paid_interest,
        interest_debt: acc.interest_debt + bl.book.summary.total_interest_debt,
        current_balance:
          acc.current_balance + bl.book.summary.current_capital_balance,
      }),
      { requested: 0, paid_capital: 0, paid_interest: 0, interest_debt: 0, current_balance: 0 },
    );
    return { user: e.user, loans, totals };
  });
}

export default function LibroAccionistaPage() {
  const router = useRouter();

  const [role, setRole] = useState<'admin' | 'accionista' | null>(null);
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<BookedEntry[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [expandedLoans, setExpandedLoans] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const fetchAll = useCallback(async () => {
    try {
      const raw = await getLibroAccionistaData(supabase);
      const booked = computeBookedEntries(raw);
      setEntries(booked);
      if (booked.length > 0) {
        // Mantener la selección actual si sigue existiendo, sino elegir la primera.
        setSelectedUserId((current) =>
          current && booked.some((b) => b.user.id === current)
            ? current
            : booked[0].user.id,
        );
        // Por defecto abrimos todos los préstamos del accionista seleccionado.
        setExpandedLoans(new Set(booked.flatMap((b) => b.loans.map((l) => l.source.loan.id))));
      } else {
        setSelectedUserId(null);
        setExpandedLoans(new Set());
      }
    } catch (err) {
      console.error('Error cargando libro de accionista:', err);
      showToast('error', 'No se pudo cargar el Libro de accionista.');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/login');
        return;
      }
      const userRole = await getProfileRole(supabase, user.id);
      if (cancelled) return;
      if (userRole !== 'admin') {
        router.replace('/dashboard/accionista');
        return;
      }
      setRole(userRole);
      await fetchAll();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [router, fetchAll]);

  // Filtra los accionistas del sidebar por nombre o documento.
  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => {
      const name = `${e.user.first_name} ${e.user.last_name}`.toLowerCase();
      const doc = (e.user.identity_document ?? '').toLowerCase();
      return name.includes(q) || doc.includes(q);
    });
  }, [entries, search]);

  // Derivamos el id efectivo: respeta la selección del usuario si sigue
  // visible en el filtro; si no, cae al primero disponible. Esto evita un
  // setState dentro de un effect (regla react-hooks/set-state-in-effect).
  const effectiveSelectedId = useMemo(() => {
    if (filteredEntries.length === 0) return null;
    if (selectedUserId && filteredEntries.some((e) => e.user.id === selectedUserId)) {
      return selectedUserId;
    }
    return filteredEntries[0].user.id;
  }, [filteredEntries, selectedUserId]);

  const selected = useMemo(
    () => entries.find((e) => e.user.id === effectiveSelectedId) ?? null,
    [entries, effectiveSelectedId],
  );

  const toggleLoan = (loanId: string) => {
    setExpandedLoans((prev) => {
      const next = new Set(prev);
      if (next.has(loanId)) next.delete(loanId);
      else next.add(loanId);
      return next;
    });
  };

  if (loading || role !== 'admin') {
    return (
      <div className="animate-pulse text-[var(--color-text-subtle)] text-sm">
        Cargando…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-7 animate-in fade-in duration-300">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-5">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-[11px] bg-[var(--color-brand-soft)] text-[var(--color-brand)] flex items-center justify-center">
            <BookUser size={20} strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="text-[26px] font-semibold tracking-[-0.025em] leading-[1.15]">
              Libro de accionista
            </h1>
            <p className="text-sm text-[var(--color-text-muted)] mt-0.5 max-w-xl">
              Seguimiento mensual de pagos de préstamos por accionista.
            </p>
          </div>
        </div>
      </header>

      {entries.length === 0 ? (
        <Card padding="lg" className="text-center py-10">
          <div className="mx-auto w-12 h-12 rounded-full bg-[var(--color-surface-alt)] flex items-center justify-center text-[var(--color-text-subtle)] mb-3">
            <BookUser size={20} strokeWidth={1.5} />
          </div>
          <h2 className="text-[15px] font-semibold tracking-tight">
            Aún no hay préstamos desembolsados
          </h2>
          <p className="text-[13px] text-[var(--color-text-muted)] mt-1">
            Cuando haya préstamos activos, aparecerán aquí.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-5">
          {/* Lista de accionistas */}
          <Card padding="none" className="overflow-hidden h-fit">
            <div className="px-4 py-3 border-b border-[var(--color-border)]">
              <div className="text-[10px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase">
                Accionistas
              </div>
              <div className="text-[11px] text-[var(--color-text-subtle)] mt-0.5">
                {entries.length} con préstamos
                {search.trim() && filteredEntries.length !== entries.length && (
                  <> · {filteredEntries.length} coincidencia
                    {filteredEntries.length === 1 ? '' : 's'}</>
                )}
              </div>
            </div>
            <div className="px-3 py-2 border-b border-[var(--color-border)]">
              <div className="flex items-center h-9 px-2.5 rounded-[8px] bg-[var(--color-surface-alt)] border border-[var(--color-border)]">
                <Search
                  size={13}
                  strokeWidth={1.75}
                  className="text-[var(--color-text-subtle)] mr-2 shrink-0"
                />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar nombre o documento…"
                  className="flex-1 bg-transparent text-[12px] focus:outline-none text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] min-w-0"
                />
              </div>
            </div>
            <div className="flex flex-col divide-y divide-[var(--color-border)]">
              {filteredEntries.length === 0 ? (
                <div className="px-4 py-6 text-center">
                  <div className="text-[12px] text-[var(--color-text-muted)]">
                    Ningún accionista coincide con &quot;{search.trim()}&quot;.
                  </div>
                </div>
              ) : (
                filteredEntries.map((e) => {
                  const active = e.user.id === effectiveSelectedId;
                  return (
                    <button
                      key={e.user.id}
                      type="button"
                      onClick={() => setSelectedUserId(e.user.id)}
                      className={`flex items-center gap-3 px-4 py-3 text-left cursor-pointer transition-colors ${
                        active
                          ? 'bg-[var(--color-brand-soft)]/50'
                          : 'hover:bg-[var(--color-surface-alt)]'
                      }`}
                    >
                      <Avatar name={e.user.first_name} size={32} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold tracking-tight truncate">
                          {e.user.first_name} {e.user.last_name}
                        </div>
                        <div className="text-[11px] text-[var(--color-text-subtle)] mt-0.5 truncate">
                          CC {e.user.identity_document} · {e.loans.length}{' '}
                          {e.loans.length === 1 ? 'préstamo' : 'préstamos'} · Saldo{' '}
                          {cop(e.totals.current_balance)}
                        </div>
                      </div>
                      {active && (
                        <ArrowRight
                          size={14}
                          strokeWidth={2}
                          className="text-[var(--color-brand)]"
                        />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </Card>

          {/* Detalle del accionista */}
          {selected && (
            <div className="flex flex-col gap-5">
              {/* Resumen del accionista */}
              <Card padding="lg">
                <div className="flex items-center gap-4">
                  <Avatar name={selected.user.first_name} size={48} />
                  <div className="flex-1 min-w-0">
                    <h2 className="text-[18px] font-semibold tracking-tight truncate">
                      {selected.user.first_name} {selected.user.last_name}
                    </h2>
                    <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 truncate">
                      CC {selected.user.identity_document} · {selected.loans.length}{' '}
                      {selected.loans.length === 1 ? 'préstamo' : 'préstamos'}
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-2 md:grid-cols-5 gap-3">
                  <SummaryStat label="Total prestado" value={cop(selected.totals.requested)} />
                  <SummaryStat label="Capital pagado" value={cop(selected.totals.paid_capital)} tone="success" />
                  <SummaryStat label="Intereses pagados" value={cop(selected.totals.paid_interest)} tone="success" />
                  <SummaryStat
                    label="Intereses en mora"
                    value={cop(selected.totals.interest_debt)}
                    tone={selected.totals.interest_debt > 0 ? 'danger' : undefined}
                  />
                  <SummaryStat
                    label="Saldo capital"
                    value={cop(selected.totals.current_balance)}
                    tone="brand"
                  />
                </div>
              </Card>

              {/* Un bloque por préstamo */}
              {selected.loans.map((bl) => {
                const l = bl.source.loan;
                const loanId = l.id;
                const isOpen = expandedLoans.has(loanId);
                const disbursedLabel = l.disbursed_at
                  ? new Date(l.disbursed_at).toLocaleDateString('es-CO', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })
                  : '—';
                const statusLabel = LOAN_STATUS_LABELS[l.status] ?? l.status;

                return (
                  <Card key={loanId} padding="none" className="overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggleLoan(loanId)}
                      className="w-full flex items-center gap-3 px-5 py-4 text-left cursor-pointer hover:bg-[var(--color-surface-alt)]/40"
                    >
                      <div className="w-9 h-9 rounded-[10px] bg-[var(--color-brand-soft)] text-[var(--color-brand)] flex items-center justify-center shrink-0">
                        <BookUser size={16} strokeWidth={1.75} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[14px] font-semibold tracking-tight">
                            {l.disbursement_number ?? 'Sin número'}
                          </span>
                          <Badge
                            tone={l.status === 'paid' ? 'success' : 'brand'}
                            dot
                          >
                            {statusLabel}
                          </Badge>
                          {bl.book.summary.total_interest_debt > 0 && (
                            <Badge tone="danger">Intereses en mora</Badge>
                          )}
                        </div>
                        <div className="text-[11px] text-[var(--color-text-subtle)] mt-0.5">
                          Desembolsado: {disbursedLabel} · {cop(Number(l.requested_amount))}
                          {' · '}
                          {l.payment_plan_months ?? bl.book.months.length} meses ·{' '}
                          {(Number(l.interest_rate) * 100).toFixed(2)}% mensual
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[13px] font-semibold tabular">
                          Saldo {cop(bl.book.summary.current_capital_balance)}
                        </div>
                        {bl.book.summary.next_installment_amount !== null && (
                          <div className="text-[11px] text-[var(--color-text-subtle)] mt-0.5">
                            Próxima cuota {cop(bl.book.summary.next_installment_amount)}
                            {bl.book.summary.next_installment_month &&
                              ` · ${monthLabel(
                                bl.book.summary.next_installment_month.slice(0, 7),
                                true,
                              )}`}
                          </div>
                        )}
                      </div>
                      <div className="w-8 h-8 rounded-[8px] flex items-center justify-center text-[var(--color-text-subtle)] shrink-0">
                        {isOpen ? (
                          <ChevronUp size={18} strokeWidth={1.75} />
                        ) : (
                          <ChevronDown size={18} strokeWidth={1.75} />
                        )}
                      </div>
                    </button>

                    {isOpen && (
                      <div className="border-t border-[var(--color-border)] overflow-x-auto">
                        <table className="w-full text-[12px] tabular">
                          <thead className="bg-[var(--color-surface-alt)]/60 text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
                            <tr>
                              <th className="text-left font-semibold px-4 py-2.5">Mes</th>
                              <th className="text-right font-semibold px-4 py-2.5">
                                Cuota plan
                              </th>
                              <th className="text-right font-semibold px-4 py-2.5">
                                Capital pagado
                              </th>
                              <th className="text-right font-semibold px-4 py-2.5">
                                Interés pagado
                              </th>
                              <th className="text-right font-semibold px-4 py-2.5">
                                Interés en mora
                              </th>
                              <th className="text-right font-semibold px-4 py-2.5">
                                Saldo capital
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--color-border)]">
                            {bl.book.months.map((row) => {
                              const monthStr = row.due_date.slice(0, 7);
                              const isNext = row.is_next_installment;
                              const hasDebt = row.interest_debt > 0;
                              return (
                                <tr
                                  key={row.month_number}
                                  className={
                                    isNext
                                      ? 'bg-[var(--color-brand-soft)]/30'
                                      : ''
                                  }
                                >
                                  <td className="px-4 py-2.5 font-medium text-[var(--color-text)]">
                                    <div className="flex items-center gap-2">
                                      <span>
                                        {row.month_number}.{' '}
                                        {monthLabel(monthStr, true)}
                                      </span>
                                      {isNext && (
                                        <Badge tone="brand">Próxima</Badge>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-4 py-2.5 text-right text-[var(--color-text-muted)]">
                                    {cop(row.installment_value)}
                                  </td>
                                  <td className="px-4 py-2.5 text-right text-[var(--color-success)]">
                                    {row.paid_capital > 0
                                      ? cop(row.paid_capital)
                                      : '—'}
                                  </td>
                                  <td className="px-4 py-2.5 text-right text-[var(--color-success)]">
                                    {row.paid_interest > 0
                                      ? cop(row.paid_interest)
                                      : '—'}
                                  </td>
                                  <td
                                    className={`px-4 py-2.5 text-right ${
                                      hasDebt
                                        ? 'text-[var(--color-danger)] font-semibold'
                                        : 'text-[var(--color-text-subtle)]'
                                    }`}
                                  >
                                    {hasDebt ? cop(row.interest_debt) : '—'}
                                  </td>
                                  <td className="px-4 py-2.5 text-right font-semibold">
                                    {cop(row.capital_balance_after)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot className="bg-[var(--color-surface-alt)]/60 text-[11px] font-semibold">
                            <tr>
                              <td className="px-4 py-2.5">Totales</td>
                              <td className="px-4 py-2.5 text-right text-[var(--color-text-muted)]">
                                {cop(
                                  bl.book.months.reduce(
                                    (s, r) => s + r.installment_value,
                                    0,
                                  ),
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-right text-[var(--color-success)]">
                                {cop(bl.book.summary.total_paid_capital)}
                              </td>
                              <td className="px-4 py-2.5 text-right text-[var(--color-success)]">
                                {cop(bl.book.summary.total_paid_interest)}
                              </td>
                              <td
                                className={`px-4 py-2.5 text-right ${
                                  bl.book.summary.total_interest_debt > 0
                                    ? 'text-[var(--color-danger)]'
                                    : 'text-[var(--color-text-subtle)]'
                                }`}
                              >
                                {bl.book.summary.total_interest_debt > 0
                                  ? cop(bl.book.summary.total_interest_debt)
                                  : '—'}
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                {cop(bl.book.summary.current_capital_balance)}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'brand' | 'success' | 'danger';
}) {
  const toneClass =
    tone === 'brand'
      ? 'text-[var(--color-brand)]'
      : tone === 'success'
        ? 'text-[var(--color-success)]'
        : tone === 'danger'
          ? 'text-[var(--color-danger)]'
          : 'text-[var(--color-text)]';
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase">
        {label}
      </span>
      <span className={`text-[17px] font-semibold tabular mt-1 ${toneClass}`}>
        {value}
      </span>
    </div>
  );
}
