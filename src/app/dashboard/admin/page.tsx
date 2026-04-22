'use client';

import React, { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { Sparkline, Bars } from '@/components/ui/charts';
import {
  ArrowUp,
  ArrowDown,
  Users,
  FileText,
  CheckCircle2,
  Filter,
  Download,
  Plus,
  ArrowRight,
} from 'lucide-react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { getProfile } from '@/lib/data/profiles';

const cop = (n: number) => '$ ' + new Intl.NumberFormat('es-CO').format(n);

// Datos de ejemplo — se reemplazarán por datos reales cuando existan tablas
// de aportes / actividad en Supabase.
const sparkData = [12, 14, 13, 16, 18, 17, 20, 22, 21, 24, 26, 28, 30, 32];
const months = [
  { label: 'Oct', value: 32 },
  { label: 'Nov', value: 38 },
  { label: 'Dic', value: 44 },
  { label: 'Ene', value: 41 },
  { label: 'Feb', value: 48 },
  { label: 'Mar', value: 52 },
  { label: 'Abr', value: 58 },
];

type ActivityTone = 'success' | 'info' | 'brand' | 'warn';
type ActivityIcon = 'arrowUp' | 'arrowDown' | 'doc' | 'check' | 'users';

type ActivityItem = {
  who: string;
  what: string;
  amount: number | null;
  when: string;
  tone: ActivityTone;
  icon: ActivityIcon;
};

const activity: ActivityItem[] = [
  { who: 'Mariana Ochoa', what: 'realizó un aporte', amount: 250_000, when: 'hace 12 min', tone: 'success', icon: 'arrowUp' },
  { who: 'Julián Pérez', what: 'solicitó préstamo', amount: 1_800_000, when: 'hace 1 h', tone: 'info', icon: 'doc' },
  { who: 'Sofía Mendoza', what: 'pagó cuota', amount: 320_000, when: 'hace 3 h', tone: 'success', icon: 'check' },
  { who: 'Andrés Villalba', what: 'se unió al grupo', amount: null, when: 'ayer', tone: 'brand', icon: 'users' },
  { who: 'Lucía Ramírez', what: 'retiró fondos', amount: 400_000, when: 'ayer', tone: 'warn', icon: 'arrowDown' },
];

const pendingSample = [
  { name: 'Valentina Ríos', doc: '52.118.903', income: 3_200_000, time: 'hace 2 h' },
  { name: 'Tomás Escobar', doc: '71.445.208', income: 4_500_000, time: 'hace 5 h' },
  { name: 'Paula Montaño', doc: '1.023.556.102', income: 2_800_000, time: 'ayer' },
];

export default function AdminDashboardPage() {
  const [firstName, setFirstName] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user || cancelled) return;
      try {
        const profile = await getProfile(supabase, data.user.id);
        if (!cancelled && profile?.first_name) setFirstName(profile.first_name);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const greeting = firstName ? `Buen día, ${firstName}` : 'Buen día';

  return (
    <div className="flex flex-col gap-7 animate-in fade-in duration-300">
      {/* Page header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-5">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.025em] leading-[1.15]">
            {greeting}
          </h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1.5">
            Esto es lo que ha pasado en el fondo esta semana.
          </p>
        </div>
        <div className="flex gap-2.5">
          <Button variant="secondary" size="md">
            <Download size={15} strokeWidth={1.75} />
            Exportar
          </Button>
          <Button size="md">
            <Plus size={15} strokeWidth={1.75} />
            Nuevo movimiento
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr] gap-[18px]">
        {/* Left column */}
        <div className="flex flex-col gap-[18px] min-w-0">
          {/* Hero balance card */}
          <Card padding="none" className="overflow-hidden">
            <div className="px-[26px] py-6 border-b border-[var(--color-border)] bg-[linear-gradient(135deg,#F2F8F3_0%,#FFFFFF_60%)] dark:bg-[linear-gradient(135deg,rgba(74,222,128,0.12)_0%,rgba(74,222,128,0.02)_60%)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[11px] font-semibold text-[var(--color-text-muted)] tracking-[0.12em] uppercase">
                    Fondo total
                  </div>
                  <div className="text-[40px] font-semibold tracking-[-0.035em] leading-[1.1] mt-2.5">
                    {cop(48_720_500)}
                    <span className="text-lg text-[var(--color-text-muted)] font-medium ml-1">
                      COP
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-4 mt-3 text-[13px] text-[var(--color-text-muted)]">
                    <span className="inline-flex items-center gap-1.5">
                      <ArrowUp
                        size={13}
                        strokeWidth={1.75}
                        className="text-[var(--color-success)]"
                      />
                      <b className="text-[var(--color-success)] font-semibold">
                        +$1.12 M
                      </b>{' '}
                      este mes
                    </span>
                    <span>·</span>
                    <span>
                      Rendimiento{' '}
                      <b className="text-[var(--color-text)] font-semibold">2.4%</b>
                    </span>
                  </div>
                </div>
                <Badge tone="success" dot>
                  En crecimiento
                </Badge>
              </div>
            </div>
            <div className="px-[26px] pt-2.5 pb-[22px]">
              <Sparkline
                data={sparkData}
                width={640}
                height={80}
                color="var(--color-brand)"
                fill="var(--color-brand)"
              />
            </div>
          </Card>

          {/* KPI row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <Kpi label="Accionistas" value="24" delta="+2" icon={Users} />
            <Kpi
              label="Préstamos activos"
              value="7"
              sub={cop(8_400_000)}
              icon={FileText}
            />
            <Kpi
              label="Cuotas al día"
              value="96%"
              sub="23 de 24"
              icon={CheckCircle2}
              tone="success"
            />
          </div>

          {/* Monthly aportes chart */}
          <Card padding="md">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-semibold tracking-tight">
                  Aportes mensuales
                </div>
                <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
                  Últimos 7 meses · en millones
                </div>
              </div>
              <div className="flex gap-1.5">
                {['6M', '1A', 'Todo'].map((k, i) => (
                  <span
                    key={k}
                    className={`text-xs font-semibold px-2.5 py-1 rounded-md ${
                      i === 0
                        ? 'bg-[var(--color-surface-alt)] text-[var(--color-text)]'
                        : 'text-[var(--color-text-muted)]'
                    }`}
                  >
                    {k}
                  </span>
                ))}
              </div>
            </div>
            <div className="text-[var(--color-text)]">
              <Bars
                data={months}
                width={640}
                height={140}
                color="var(--color-brand)"
                track="var(--color-surface-alt)"
              />
            </div>
          </Card>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-[18px] min-w-0">
          {/* Pending requests */}
          <Card padding="none">
            <div className="px-5 pt-[18px] pb-3.5 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold tracking-tight">
                  Solicitudes pendientes
                </div>
                <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
                  {pendingSample.length} esperan tu revisión
                </div>
              </div>
              <Link
                href="/dashboard/solicitudes"
                className="text-xs font-semibold text-[var(--color-brand)] hover:underline inline-flex items-center gap-1"
              >
                Ver todas <ArrowRight size={12} strokeWidth={2} />
              </Link>
            </div>
            <div>
              {pendingSample.map((r, i) => (
                <div
                  key={i}
                  className="px-5 py-3 flex items-center gap-3 border-t border-[var(--color-border)]"
                >
                  <Avatar name={r.name} size={34} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold tracking-tight truncate">
                      {r.name}
                    </div>
                    <div className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                      CC {r.doc} · Ingreso {cop(r.income)}
                    </div>
                  </div>
                  <div className="text-[11px] text-[var(--color-text-subtle)] whitespace-nowrap">
                    {r.time}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Activity feed */}
          <Card padding="none" className="flex-1 min-h-0">
            <div className="px-5 pt-[18px] pb-3.5 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold tracking-tight">
                  Actividad reciente
                </div>
                <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
                  En tiempo real
                </div>
              </div>
              <Filter
                size={15}
                strokeWidth={1.75}
                className="text-[var(--color-text-muted)]"
              />
            </div>
            <div>
              {activity.map((a, i) => (
                <ActivityRow key={i} item={a} />
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

const toneToBg: Record<ActivityTone, string> = {
  success: 'bg-[var(--color-success-soft)] text-[var(--color-success)]',
  info: 'bg-[var(--color-info-soft)] text-[var(--color-info)]',
  brand: 'bg-[var(--color-brand-soft)] text-[var(--color-brand)]',
  warn: 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]',
};

function ActivityRow({ item }: { item: ActivityItem }) {
  const Icon = ICONS[item.icon];
  const sign = item.icon === 'arrowDown' ? '−' : '+';
  return (
    <div className="px-5 py-3 flex items-center gap-3 border-t border-[var(--color-border)]">
      <div
        className={`w-8 h-8 rounded-[8px] flex items-center justify-center shrink-0 ${toneToBg[item.tone]}`}
      >
        <Icon size={14} strokeWidth={1.75} />
      </div>
      <div className="flex-1 min-w-0 text-[13px]">
        <span className="font-semibold">{item.who}</span>{' '}
        <span className="text-[var(--color-text-muted)]">{item.what}</span>
        <div className="text-[11px] text-[var(--color-text-subtle)] mt-0.5">
          {item.when}
        </div>
      </div>
      {item.amount && (
        <div className="text-[13px] font-semibold text-[var(--color-text)] tracking-tight whitespace-nowrap">
          {sign}
          {cop(item.amount).replace('$ ', '$')}
        </div>
      )}
    </div>
  );
}

const ICONS = {
  arrowUp: ArrowUp,
  arrowDown: ArrowDown,
  doc: FileText,
  check: CheckCircle2,
  users: Users,
} as const;

type KpiTone = 'success' | 'warn' | 'danger' | 'info' | 'brand';
type LucideIcon = typeof Users;

function Kpi({
  label,
  value,
  sub,
  delta,
  icon: IconComp,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: string;
  icon: LucideIcon;
  tone?: KpiTone;
}) {
  const toneBg: Record<KpiTone, string> = {
    success: 'bg-[var(--color-success-soft)] text-[var(--color-success)]',
    warn: 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]',
    danger: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]',
    info: 'bg-[var(--color-info-soft)] text-[var(--color-info)]',
    brand: 'bg-[var(--color-brand-soft)] text-[var(--color-brand)]',
  };
  const iconClass = tone
    ? toneBg[tone]
    : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]';
  return (
    <Card padding="none" className="p-[18px]">
      <div className="flex items-center justify-between mb-4">
        <div
          className={`w-[30px] h-[30px] rounded-[8px] flex items-center justify-center ${iconClass}`}
        >
          <IconComp size={15} strokeWidth={1.75} />
        </div>
        {delta && <Badge tone="success">{delta}</Badge>}
      </div>
      <div className="text-[11px] font-semibold text-[var(--color-text-muted)] tracking-[0.07em] uppercase">
        {label}
      </div>
      <div className="text-[26px] font-semibold tracking-[-0.03em] mt-1 leading-none">
        {value}
      </div>
      {sub && (
        <div className="text-xs text-[var(--color-text-muted)] mt-1.5">{sub}</div>
      )}
    </Card>
  );
}
