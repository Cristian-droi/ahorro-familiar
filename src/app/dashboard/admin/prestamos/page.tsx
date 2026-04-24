'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ChevronRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getAllLoans } from '@/lib/data/loans';
import type { Loan } from '@/types/entities';
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
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalShareholders, setTotalShareholders] = useState(0);

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

  if (loading) {
    return <div className="animate-pulse text-[var(--color-text-subtle)] text-sm">Cargando…</div>;
  }

  const sorted = [...loans].sort((a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99));

  const getGroup = (loan: Loan) => {
    for (const g of STATUS_GROUPS) {
      if (g.key.split(',').includes(loan.status)) return g.label;
    }
    return 'Otros';
  };

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

      {groups.length === 0 && (
        <Card padding="lg" className="text-center">
          <div className="text-[var(--color-text-muted)] text-sm">No hay préstamos registrados.</div>
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

function AdminLoanRow({ loan, needed, total }: { loan: Loan; needed: number; total: number }) {
  const tone = LOAN_STATUS_TONE[loan.status] as Parameters<typeof Badge>[0]['tone'];
  return (
    <Link
      href={`/dashboard/admin/prestamos/${loan.id}`}
      className="flex items-center gap-4 px-5 py-4 border-t border-[var(--color-border)] first:border-t-0 hover:bg-[var(--color-surface-alt)]/50 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold">
          {cop(Number(loan.requested_amount))}
          <span className="text-[var(--color-text-muted)] font-normal ml-2">
            · {loan.payment_plan_months ?? '—'} meses
          </span>
        </div>
        <div className="text-[11px] text-[var(--color-text-subtle)] mt-0.5">
          {new Date(loan.created_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}
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
