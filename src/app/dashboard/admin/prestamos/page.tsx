'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { ChevronRight, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getAllLoans, type LoanWithBorrower } from '@/lib/data/loans';
import { cop } from '@/lib/format';
import { LOAN_STATUS_LABELS, LOAN_STATUS_TONE, requiredVotes } from '@/lib/loans';

const STATUS_ORDER: Record<string, number> = {
  pending_review: 0,
  pending_shareholder_vote: 1,
  pending_disbursement: 2,
  active: 3,
  draft: 4,
  paid: 5,
  rejected_by_admin: 6,
  rejected_by_shareholders: 7,
};

const STATUS_GROUPS = [
  { key: 'pending_review', label: 'Pendientes de revisión' },
  { key: 'pending_shareholder_vote', label: 'En votación' },
  { key: 'pending_disbursement', label: 'Listos para desembolso' },
  { key: 'active', label: 'Activos' },
  { key: 'draft', label: 'Borradores' },
  { key: 'paid', label: 'Pagados' },
  { key: 'rejected_by_admin,rejected_by_shareholders', label: 'Rechazados' },
];

export default function AdminPrestamosPage() {
  const [loans, setLoans] = useState<LoanWithBorrower[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalShareholders, setTotalShareholders] = useState(0);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [loansData, totalRes] = await Promise.all([
        getAllLoans(supabase),
        supabase.rpc('count_active_shareholders'),
      ]);
      if (cancelled) return;
      setLoans(loansData);
      setTotalShareholders(Number(totalRes.data ?? 0));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Filtra por nombre del accionista o documento. Si no hay query, devuelve todo.
  const filteredLoans = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return loans;
    return loans.filter((loan) => {
      const b = loan.borrower;
      if (!b) return false;
      const name = `${b.first_name} ${b.last_name}`.toLowerCase();
      const doc = (b.identity_document ?? '').toLowerCase();
      return name.includes(q) || doc.includes(q);
    });
  }, [loans, search]);

  if (loading) {
    return <div className="animate-pulse text-[var(--color-text-subtle)] text-sm">Cargando…</div>;
  }

  const sorted = [...filteredLoans].sort(
    (a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99),
  );

  const groups = STATUS_GROUPS.map((g) => ({
    ...g,
    loans: sorted.filter((l) => g.key.split(',').includes(l.status)),
  })).filter((g) => g.loans.length > 0);

  const needed = requiredVotes(totalShareholders);

  return (
    <div className="flex flex-col gap-7 animate-in fade-in duration-300">
      <header>
        <h1 className="text-[26px] font-semibold tracking-[-0.025em] leading-[1.15]">Préstamos</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1.5">
          Todas las solicitudes y préstamos activos del fondo.
        </p>
      </header>

      {/* Barra de búsqueda */}
      <div className="flex items-center h-10 px-3 rounded-[10px] bg-[var(--color-surface-alt)] border border-[var(--color-border)]">
        <Search
          size={15}
          strokeWidth={1.75}
          className="text-[var(--color-text-subtle)] mr-2 shrink-0"
        />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre o documento del accionista…"
          className="flex-1 bg-transparent text-[13px] focus:outline-none text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)]"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
          >
            Limpiar
          </button>
        )}
      </div>

      {groups.length === 0 && (
        <Card padding="lg" className="text-center">
          <div className="text-[var(--color-text-muted)] text-sm">
            {search.trim()
              ? `Ningún préstamo coincide con "${search.trim()}".`
              : 'No hay préstamos registrados.'}
          </div>
        </Card>
      )}

      {groups.map((group) => (
        <div key={group.key}>
          <div className="text-[11px] font-semibold text-[var(--color-text-subtle)] tracking-[0.12em] uppercase mb-2 px-1">
            {group.label} ({group.loans.length})
          </div>
          <Card padding="none">
            {group.loans.map((loan) => (
              <AdminLoanRow key={loan.id} loan={loan} needed={needed} total={totalShareholders} />
            ))}
          </Card>
        </div>
      ))}
    </div>
  );
}

function AdminLoanRow({
  loan,
  needed,
  total,
}: {
  loan: LoanWithBorrower;
  needed: number;
  total: number;
}) {
  const tone = LOAN_STATUS_TONE[loan.status] as Parameters<typeof Badge>[0]['tone'];
  const b = loan.borrower;
  const borrowerName = b ? `${b.first_name} ${b.last_name}`.trim() : 'Sin accionista';
  const borrowerDoc = b?.identity_document ?? '';

  return (
    <Link
      href={`/dashboard/admin/prestamos/${loan.id}`}
      className="flex items-center gap-4 px-5 py-4 border-t border-[var(--color-border)] first:border-t-0 hover:bg-[var(--color-surface-alt)]/50 transition-colors"
    >
      <Avatar name={b?.first_name ?? '?'} size={36} />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold tracking-tight truncate">
          {borrowerName}
          {borrowerDoc && (
            <span className="text-[var(--color-text-subtle)] font-normal ml-2">
              · CC {borrowerDoc}
            </span>
          )}
        </div>
        <div className="text-[12px] text-[var(--color-text-muted)] mt-0.5 truncate">
          {cop(Number(loan.requested_amount))} ·{' '}
          {loan.payment_plan_months ?? '—'} meses ·{' '}
          {new Date(loan.created_at).toLocaleDateString('es-CO', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
          {loan.status === 'active' && (
            <> · Saldo: {cop(Number(loan.outstanding_balance))}</>
          )}
          {loan.status === 'pending_shareholder_vote' && (
            <> · Se necesitan {needed} votos de {total}</>
          )}
        </div>
      </div>
      <Badge tone={tone}>{LOAN_STATUS_LABELS[loan.status]}</Badge>
      <ChevronRight size={16} strokeWidth={1.75} className="text-[var(--color-text-subtle)] shrink-0" />
    </Link>
  );
}
