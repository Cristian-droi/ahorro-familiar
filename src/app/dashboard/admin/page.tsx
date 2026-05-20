'use client';

// Dashboard del administrador. Muestra los KPIs más relevantes del fondo:
//   - Accionistas activos
//   - Saldo en caja
//   - Ingresos del mes (recibos aprobados con reviewed_at en el mes)
//   - Egresos del mes (desembolsos con disbursed_at en el mes)
//   - Multas pendientes del mes actual (accionistas que aún no compraron
//     acciones ese mes y ya pasó el período de gracia)
//   - Acciones pendientes para el admin (recibos por aprobar, préstamos
//     en revisión / por desembolsar, solicitudes de ingreso)

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import {
  Users,
  Wallet,
  ArrowUp,
  ArrowDown,
  AlertTriangle,
  FileText,
  Receipt,
  Landmark,
  ChevronRight,
  CheckCircle2,
  TrendingUp,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getProfile, listProfilesWithNames } from '@/lib/data/profiles';
import {
  getCashBalance,
  getLoansWithDisbursement,
  countAdminPendingLoans,
} from '@/lib/data/loans';
import {
  countPendingReceipts,
  listAllReceiptsWithItems,
} from '@/lib/data/receipts';
import { countPendingMembershipRequests } from '@/lib/data/membership-requests';
import {
  computeFineDetail,
  DEFAULT_PURCHASE_RULES,
  getBogotaCurrentMonth,
  getBogotaToday,
  type PurchaseRules,
} from '@/lib/fines';
import { cop } from '@/lib/format';

type ProfileLite = {
  id: string;
  first_name: string;
  last_name: string;
  identity_document: string;
};

type OverdueRow = {
  user: ProfileLite;
  amount: number;
  daysLate: number;
};

export default function AdminDashboardPage() {
  const [firstName, setFirstName] = useState<string>('');
  const [loading, setLoading] = useState(true);

  // KPIs
  const [activeShareholders, setActiveShareholders] = useState<number>(0);
  const [cashBalance, setCashBalance] = useState<number>(0);
  const [inflowMonth, setInflowMonth] = useState<number>(0);
  const [outflowMonth, setOutflowMonth] = useState<number>(0);

  // Pendientes
  const [pendingReceipts, setPendingReceipts] = useState<number>(0);
  const [pendingMembership, setPendingMembership] = useState<number>(0);
  const [pendingLoanReview, setPendingLoanReview] = useState<number>(0);
  const [pendingLoanDisbursement, setPendingLoanDisbursement] = useState<number>(0);

  // Multas del mes actual
  const [overdue, setOverdue] = useState<OverdueRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user || cancelled) return;
      try {
        const profile = await getProfile(supabase, authData.user.id);
        if (!cancelled && profile?.first_name) setFirstName(profile.first_name);
      } catch {
        /* ignore */
      }

      const ym = getBogotaCurrentMonth().slice(0, 7);
      const today = getBogotaToday();

      try {
        const [
          shareholdersRes,
          balance,
          receipts,
          disbursements,
          pendReceipts,
          pendMembership,
          pendLoans,
          profiles,
          rulesRes,
        ] = await Promise.all([
          supabase.rpc('count_active_shareholders'),
          getCashBalance(supabase).catch(() => 0),
          listAllReceiptsWithItems(supabase, { status: 'approved' }).catch(
            () => [],
          ),
          getLoansWithDisbursement(supabase).catch(() => []),
          countPendingReceipts(supabase).catch(() => 0),
          countPendingMembershipRequests(supabase).catch(() => 0),
          countAdminPendingLoans(supabase).catch(() => ({
            pendingReview: 0,
            pendingDisbursement: 0,
            total: 0,
          })),
          listProfilesWithNames(supabase).catch(() => []),
          supabase
            .from('system_settings')
            .select('value')
            .eq('key', 'purchase_rules')
            .maybeSingle(),
        ]);

        if (cancelled) return;

        setActiveShareholders(Number(shareholdersRes.data ?? 0));
        setCashBalance(Number(balance));
        setPendingReceipts(pendReceipts);
        setPendingMembership(pendMembership);
        setPendingLoanReview(pendLoans.pendingReview);
        setPendingLoanDisbursement(pendLoans.pendingDisbursement);

        // Ingresos del mes = recibos aprobados con reviewed_at del mes
        // (ó submitted_at de fallback). Suma total_amount.
        let inflow = 0;
        for (const r of receipts) {
          const date = (r.reviewed_at ?? r.submitted_at ?? '').slice(0, 7);
          if (date === ym) inflow += Number(r.total_amount ?? 0);
        }
        setInflowMonth(inflow);

        // Egresos del mes = desembolsos con disbursed_at del mes (usamos
        // requested_amount = monto bruto otorgado, consistente con la
        // tarjeta del libro de caja).
        let outflow = 0;
        for (const d of disbursements) {
          const date = (d.disbursed_at ?? '').slice(0, 7);
          if (date === ym) outflow += Number(d.requested_amount ?? 0);
        }
        setOutflowMonth(outflow);

        // Multas del mes actual: por cada accionista activo, si NO tiene
        // receipt approved/pending con concept='acciones' para este mes
        // Y ya pasó el período de gracia, calculamos la multa proyectada.
        const rules: PurchaseRules = rulesRes?.data?.value
          ? {
              ...DEFAULT_PURCHASE_RULES,
              ...(rulesRes.data.value as Partial<PurchaseRules>),
            }
          : DEFAULT_PURCHASE_RULES;

        const monthFirst = `${ym}-01`;

        // Para esto necesitamos los items del mes actual de TODOS los
        // recibos (pending o approved) con concept='acciones'.
        const { data: itemsThisMonth } = await supabase
          .from('receipt_items')
          .select('receipt_id, target_month, receipts!inner(user_id, status)')
          .eq('concept', 'acciones')
          .eq('target_month', monthFirst)
          .in('receipts.status', ['pending', 'approved']);

        const usersWithActivity = new Set(
          (itemsThisMonth ?? [])
            .map((r) => (r as Record<string, unknown> & { receipts: { user_id: string } }).receipts?.user_id)
            .filter(Boolean),
        );

        const fineDetail = computeFineDetail(monthFirst, today, rules);
        const overdueList: OverdueRow[] = [];
        if (fineDetail.amount > 0) {
          for (const p of profiles) {
            if (usersWithActivity.has(p.id)) continue;
            overdueList.push({
              user: p,
              amount: fineDetail.amount,
              daysLate: fineDetail.chargedDays,
            });
          }
        }
        // Orden alfabético por nombre.
        overdueList.sort((a, b) =>
          `${a.user.first_name} ${a.user.last_name}`.localeCompare(
            `${b.user.first_name} ${b.user.last_name}`,
          ),
        );
        setOverdue(overdueList);
      } catch (err) {
        console.error('Error cargando dashboard admin:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const greeting = firstName ? `Buen día, ${firstName}` : 'Buen día';
  const monthLabelEs = useMemo(() => {
    const d = new Date();
    return d.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
  }, []);

  const totalPendingActions =
    pendingReceipts +
    pendingMembership +
    pendingLoanReview +
    pendingLoanDisbursement;

  return (
    <div className="flex flex-col gap-7 animate-in fade-in duration-300">
      {/* Page header */}
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.025em] leading-[1.15]">
          {greeting}
        </h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1.5 capitalize">
          Resumen del fondo · {monthLabelEs}
        </p>
      </div>

      {/* KPIs principales */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <Kpi
          icon={Users}
          tone="brand"
          label="Accionistas activos"
          value={loading ? '…' : `${activeShareholders}`}
          href="/dashboard/miembros"
        />
        <Kpi
          icon={Wallet}
          tone="success"
          label="Saldo en caja"
          value={loading ? '…' : cop(cashBalance)}
          href="/dashboard/libro-caja"
        />
        <Kpi
          icon={ArrowUp}
          tone="success"
          label="Ingresos del mes"
          value={loading ? '…' : cop(inflowMonth)}
          href="/dashboard/libro-caja"
        />
        <Kpi
          icon={ArrowDown}
          tone="danger"
          label="Egresos del mes"
          value={loading ? '…' : cop(outflowMonth)}
          href="/dashboard/libro-caja"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">
        {/* Multas pendientes del mes */}
        <Card padding="none" className="overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[var(--color-border)] flex items-center gap-3">
            <div className="w-9 h-9 rounded-[10px] bg-[var(--color-warn-soft)] text-[var(--color-warn)] flex items-center justify-center shrink-0">
              <AlertTriangle size={16} strokeWidth={1.75} />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-[14px] font-semibold tracking-tight">
                Multas pendientes este mes
              </h2>
              <p className="text-[11px] text-[var(--color-text-subtle)] mt-0.5">
                Accionistas que aún no han comprado acciones de{' '}
                <span className="capitalize">{monthLabelEs}</span>.
              </p>
            </div>
            {overdue.length > 0 && (
              <Badge tone="warn">
                {overdue.length}{' '}
                {overdue.length === 1 ? 'pendiente' : 'pendientes'}
              </Badge>
            )}
          </div>

          {loading ? (
            <div className="px-5 py-6 text-center text-[12px] text-[var(--color-text-subtle)] animate-pulse">
              Cargando…
            </div>
          ) : overdue.length === 0 ? (
            <div className="px-5 py-10 flex flex-col items-center gap-2 text-center">
              <CheckCircle2
                size={28}
                strokeWidth={1.5}
                className="text-[var(--color-success)]"
              />
              <p className="text-[13px] font-semibold">
                Todos al día por ahora
              </p>
              <p className="text-[11px] text-[var(--color-text-subtle)] max-w-xs">
                Aún no hay accionistas con multa proyectada este mes (o nadie
                pasó el período de gracia).
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-border)]">
              {overdue.map((o) => (
                <div
                  key={o.user.id}
                  className="flex items-center gap-3 px-5 py-3"
                >
                  <Avatar name={o.user.first_name} size={32} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold tracking-tight truncate">
                      {o.user.first_name} {o.user.last_name}
                    </div>
                    <div className="text-[11px] text-[var(--color-text-subtle)]">
                      CC {o.user.identity_document} · {o.daysLate}{' '}
                      {o.daysLate === 1 ? 'día' : 'días'} de mora
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[13px] font-semibold tabular text-[var(--color-warn)]">
                      {cop(o.amount)}
                    </div>
                    <div className="text-[10px] text-[var(--color-text-subtle)]">
                      proyectada
                    </div>
                  </div>
                </div>
              ))}
              <div className="px-5 py-3 bg-[var(--color-surface-alt)] flex items-center justify-between">
                <span className="text-[12px] font-semibold text-[var(--color-text-muted)]">
                  Total proyectado
                </span>
                <span className="text-[14px] font-semibold tabular text-[var(--color-warn)]">
                  {cop(overdue.reduce((s, o) => s + o.amount, 0))}
                </span>
              </div>
            </div>
          )}
        </Card>

        {/* Acciones pendientes del admin */}
        <Card padding="none" className="overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[var(--color-border)] flex items-center gap-3">
            <div className="w-9 h-9 rounded-[10px] bg-[var(--color-brand-soft)] text-[var(--color-brand)] flex items-center justify-center shrink-0">
              <TrendingUp size={16} strokeWidth={1.75} />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-[14px] font-semibold tracking-tight">
                Tu bandeja
              </h2>
              <p className="text-[11px] text-[var(--color-text-subtle)] mt-0.5">
                {totalPendingActions === 0
                  ? 'Estás al día'
                  : `${totalPendingActions} ${totalPendingActions === 1 ? 'tarea' : 'tareas'}`}
              </p>
            </div>
          </div>

          {loading ? (
            <div className="px-5 py-6 text-center text-[12px] text-[var(--color-text-subtle)] animate-pulse">
              Cargando…
            </div>
          ) : totalPendingActions === 0 ? (
            <div className="px-5 py-10 flex flex-col items-center gap-2 text-center">
              <CheckCircle2
                size={28}
                strokeWidth={1.5}
                className="text-[var(--color-success)]"
              />
              <p className="text-[13px] font-semibold">Sin pendientes</p>
              <p className="text-[11px] text-[var(--color-text-subtle)] max-w-xs">
                Cuando llegue una solicitud o un recibo aparecerán acá.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-border)]">
              {pendingMembership > 0 && (
                <InboxRow
                  icon={FileText}
                  label="Solicitudes de ingreso"
                  count={pendingMembership}
                  href="/dashboard/solicitudes"
                />
              )}
              {pendingReceipts > 0 && (
                <InboxRow
                  icon={Receipt}
                  label="Recibos por aprobar"
                  count={pendingReceipts}
                  href="/dashboard/libro-caja"
                />
              )}
              {pendingLoanReview > 0 && (
                <InboxRow
                  icon={Landmark}
                  label="Préstamos en revisión"
                  count={pendingLoanReview}
                  href="/dashboard/admin/prestamos"
                />
              )}
              {pendingLoanDisbursement > 0 && (
                <InboxRow
                  icon={Landmark}
                  label="Préstamos por desembolsar"
                  count={pendingLoanDisbursement}
                  href="/dashboard/admin/prestamos"
                />
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// =============================================================================
// Subcomponentes
// =============================================================================

function Kpi({
  icon: Icon,
  tone,
  label,
  value,
  href,
}: {
  icon: typeof Users;
  tone: 'brand' | 'success' | 'danger' | 'warn';
  label: string;
  value: string;
  href: string;
}) {
  const toneBg: Record<typeof tone, string> = {
    brand: 'bg-[var(--color-brand-soft)] text-[var(--color-brand)]',
    success: 'bg-[var(--color-success-soft)] text-[var(--color-success)]',
    danger: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]',
    warn: 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]',
  };
  return (
    <Link href={href} className="block group">
      <Card padding="md" className="group-hover:border-[var(--color-brand)]/40 transition-colors">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div
            className={`w-9 h-9 rounded-[10px] flex items-center justify-center ${toneBg[tone]}`}
          >
            <Icon size={16} strokeWidth={1.75} />
          </div>
          <ChevronRight
            size={14}
            strokeWidth={1.75}
            className="text-[var(--color-text-subtle)] opacity-0 group-hover:opacity-100 transition-opacity"
          />
        </div>
        <div className="text-[11px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase">
          {label}
        </div>
        <div className="text-[20px] font-semibold tracking-[-0.02em] tabular mt-0.5">
          {value}
        </div>
      </Card>
    </Link>
  );
}

function InboxRow({
  icon: Icon,
  label,
  count,
  href,
}: {
  icon: typeof Users;
  label: string;
  count: number;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--color-surface-alt)] transition-colors"
    >
      <div className="w-8 h-8 rounded-[8px] bg-[var(--color-surface-alt)] flex items-center justify-center text-[var(--color-text-muted)] shrink-0">
        <Icon size={14} strokeWidth={1.75} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-medium tracking-tight text-[var(--color-text)] truncate">
          {label}
        </div>
      </div>
      <span className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-[var(--color-brand)] text-white dark:text-[var(--color-brand-ink)] text-[11px] font-bold inline-flex items-center justify-center shrink-0">
        {count}
      </span>
      <ChevronRight
        size={14}
        strokeWidth={1.75}
        className="text-[var(--color-text-subtle)] shrink-0"
      />
    </Link>
  );
}
