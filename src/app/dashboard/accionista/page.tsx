'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Sparkline, Donut } from '@/components/ui/charts';
import {
  ArrowUp,
  ArrowDown,
  Sparkles,
  FileText,
  Plus,
  ArrowRight,
  Landmark,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getProfile } from '@/lib/data/profiles';

const cop = (n: number) => '$ ' + new Intl.NumberFormat('es-CO').format(n);

const sparkData = [2, 3, 3.5, 4, 4.5, 5.2, 5.8, 6.4, 7, 7.8, 8.4, 9.2, 9.8, 10.4];

type TxType = 'in' | 'out' | 'yield';

const transactions: { label: string; date: string; amount: number; type: TxType }[] = [
  { label: 'Aporte mensual · abril', date: '14 abr 2026', amount: 250_000, type: 'in' },
  { label: 'Rendimiento trimestral', date: '01 abr 2026', amount: 118_500, type: 'yield' },
  { label: 'Aporte mensual · marzo', date: '14 mar 2026', amount: 250_000, type: 'in' },
  { label: 'Pago cuota préstamo', date: '02 mar 2026', amount: 180_000, type: 'out' },
];

const txIconMap = {
  in: ArrowUp,
  out: ArrowDown,
  yield: Sparkles,
} as const;

const txToneMap: Record<TxType, string> = {
  in: 'bg-[var(--color-success-soft)] text-[var(--color-success)]',
  out: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]',
  yield: 'bg-[var(--color-info-soft)] text-[var(--color-info)]',
};

export default function AccionistaDashboardPage() {
  const [firstName, setFirstName] = useState<string>('');
  // Necesitamos saber si el accionista ya eligió su valor de acción para
  // mostrarle el banner de onboarding. Null = aún cargando, 0 = no elegido.
  const [shareValue, setShareValue] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user || cancelled) return;
      try {
        const profile = await getProfile(supabase, data.user.id);
        if (cancelled) return;
        if (profile?.first_name) setFirstName(profile.first_name);
        setShareValue(profile?.selected_share_value ?? null);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const greeting = firstName ? `Hola, ${firstName}` : 'Hola';
  const needsShareValue = shareValue === null;

  return (
    <div className="flex flex-col gap-7 animate-in fade-in duration-300">
      {/* Page header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-5">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.025em] leading-[1.15]">
            {greeting}
          </h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1.5">
            Así va tu capital dentro del fondo familiar.
          </p>
        </div>
        <div className="flex gap-2.5">
          <Button variant="secondary" size="md">
            <FileText size={15} strokeWidth={1.75} />
            Ver cartola
          </Button>
          <Button size="md">
            <Plus size={15} strokeWidth={1.75} />
            Registrar aporte
          </Button>
        </div>
      </div>

      {/* Onboarding: primer ingreso sin valor de acción elegido.
          Es un recordatorio, no un bloqueo — el usuario puede seguir
          explorando el dashboard mientras decide. */}
      {needsShareValue && (
        <Card
          padding="md"
          className="border border-[var(--color-brand)]/25 bg-[var(--color-brand-soft)] dark:bg-[var(--color-surface)] flex flex-col sm:flex-row sm:items-center gap-4"
        >
          <div className="w-10 h-10 rounded-[10px] bg-[var(--color-brand)] text-white dark:text-[var(--color-brand-ink)] flex items-center justify-center shrink-0">
            <Landmark size={18} strokeWidth={1.75} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-semibold tracking-tight text-[var(--color-text)]">
              Activa tu cuenta eligiendo tu valor de acción
            </div>
            <div className="text-[12.5px] text-[var(--color-text-muted)] leading-[1.5] mt-0.5">
              Define cuánto aportarás como acción cada mes. Solo podrás elegirlo
              una vez — si necesitas cambiarlo luego, el administrador puede
              autorizarlo.
            </div>
          </div>
          <Link href="/dashboard/ajustes" className="shrink-0">
            <Button size="md">
              Elegir valor
              <ArrowRight size={15} strokeWidth={1.75} />
            </Button>
          </Link>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-[18px]">
        {/* Left column */}
        <div className="flex flex-col gap-[18px] min-w-0">
          {/* Hero balance */}
          <Card padding="none" className="overflow-hidden">
            <div className="px-[26px] pt-6 pb-5 border-b border-[var(--color-border)] bg-[linear-gradient(135deg,#F2F8F3,#FFFFFF_70%)] dark:bg-[linear-gradient(135deg,rgba(74,222,128,0.14),transparent_70%)]">
              <div className="flex justify-between items-start gap-4">
                <div>
                  <div className="text-[11px] font-semibold text-[var(--color-text-muted)] tracking-[0.12em] uppercase">
                    Mi capital acumulado
                  </div>
                  <div className="text-[40px] font-semibold tracking-[-0.035em] leading-[1.1] mt-2.5">
                    {cop(10_420_000)}
                  </div>
                  <div className="flex flex-wrap gap-4 mt-3 text-[13px] text-[var(--color-text-muted)]">
                    <span className="inline-flex items-center gap-1">
                      <ArrowUp
                        size={13}
                        strokeWidth={1.75}
                        className="text-[var(--color-success)]"
                      />
                      <b className="text-[var(--color-success)] font-semibold">
                        +$420 k
                      </b>{' '}
                      en el año
                    </span>
                    <span>·</span>
                    <span>
                      <b className="text-[var(--color-text)] font-semibold">21%</b> del
                      fondo
                    </span>
                  </div>
                </div>
                <Donut
                  value={72}
                  size={96}
                  stroke={10}
                  color="var(--color-brand)"
                  track="var(--color-surface-alt)"
                >
                  <div className="text-[18px] font-semibold tracking-[-0.02em]">
                    72%
                  </div>
                  <div className="text-[10px] text-[var(--color-text-muted)]">
                    meta anual
                  </div>
                </Donut>
              </div>
            </div>
            <div className="px-[26px] pt-3 pb-[22px]">
              <Sparkline
                data={sparkData}
                width={580}
                height={90}
                color="var(--color-brand)"
                fill="var(--color-brand)"
              />
              <div className="flex justify-between text-[11px] text-[var(--color-text-subtle)] mt-1.5">
                <span>Ene</span>
                <span>Mar</span>
                <span>May</span>
                <span>Jul</span>
                <span>Sep</span>
                <span>Hoy</span>
              </div>
            </div>
          </Card>

          {/* Transactions */}
          <Card padding="none">
            <div className="px-[22px] pt-[18px] pb-3.5 flex justify-between items-center">
              <div>
                <div className="text-sm font-semibold tracking-tight">
                  Movimientos recientes
                </div>
                <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
                  Tus últimos aportes y retiros
                </div>
              </div>
              <span className="text-xs font-semibold text-[var(--color-brand)] cursor-pointer hover:underline">
                Ver historial →
              </span>
            </div>
            {transactions.map((tx, i) => {
              const Icon = txIconMap[tx.type];
              const sign = tx.type === 'out' ? '−' : '+';
              return (
                <div
                  key={i}
                  className="px-[22px] py-3 flex items-center gap-3 border-t border-[var(--color-border)]"
                >
                  <div
                    className={`w-8 h-8 rounded-[8px] flex items-center justify-center shrink-0 ${txToneMap[tx.type]}`}
                  >
                    <Icon size={14} strokeWidth={1.75} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold tracking-tight truncate">
                      {tx.label}
                    </div>
                    <div className="text-[11px] text-[var(--color-text-subtle)] mt-0.5">
                      {tx.date}
                    </div>
                  </div>
                  <div
                    className={`text-[13px] font-semibold whitespace-nowrap ${
                      tx.type === 'out'
                        ? 'text-[var(--color-danger)]'
                        : 'text-[var(--color-text)]'
                    }`}
                  >
                    {sign}
                    {cop(tx.amount).replace('$ ', '$')}
                  </div>
                </div>
              );
            })}
          </Card>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-[18px] min-w-0">
          {/* Next payment */}
          <Card padding="md">
            <div className="flex items-center justify-between mb-3.5">
              <div className="text-[11px] font-semibold text-[var(--color-text-muted)] tracking-[0.12em] uppercase">
                Próxima cuota
              </div>
              <Badge tone="warn" dot>
                En 6 días
              </Badge>
            </div>
            <div className="text-[28px] font-semibold tracking-[-0.03em] leading-none">
              {cop(180_000)}
            </div>
            <div className="text-xs text-[var(--color-text-muted)] mt-1.5">
              23 de abril · Cuota 4 de 12 del préstamo activo
            </div>
            <div className="h-px bg-[var(--color-border)] my-4" />
            <div className="flex gap-2">
              <Button size="sm">Pagar ahora</Button>
              <Button variant="secondary" size="sm">
                Recordarme
              </Button>
            </div>
          </Card>

          {/* Active loan */}
          <Card padding="md">
            <div className="flex items-center justify-between mb-3.5">
              <div className="text-[11px] font-semibold text-[var(--color-text-muted)] tracking-[0.12em] uppercase">
                Préstamo activo
              </div>
              <span className="text-[11px] text-[var(--color-text-subtle)]">
                ID #PR-0214
              </span>
            </div>
            <div className="flex justify-between items-end mb-3">
              <div>
                <div className="text-xs text-[var(--color-text-muted)]">
                  Saldo pendiente
                </div>
                <div className="text-[22px] font-semibold tracking-[-0.02em]">
                  {cop(1_440_000)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-[var(--color-text-muted)]">Pagado</div>
                <div className="text-sm font-semibold text-[var(--color-success)]">
                  {cop(720_000)}
                </div>
              </div>
            </div>
            <div className="h-2 bg-[var(--color-surface-alt)] rounded overflow-hidden">
              <div
                className="h-full bg-[var(--color-brand)] rounded"
                style={{ width: '33%' }}
              />
            </div>
            <div className="flex justify-between mt-2 text-[11px] text-[var(--color-text-subtle)]">
              <span>4 / 12 cuotas</span>
              <span>Tasa 1.2% mensual</span>
            </div>
          </Card>

          {/* CTA card */}
          <Card
            padding="none"
            className="p-5 bg-[var(--color-brand-soft)] dark:bg-[var(--color-surface)]"
          >
            <Sparkles
              size={22}
              strokeWidth={1.75}
              className="text-[var(--color-brand)]"
            />
            <div className="text-[15px] font-semibold tracking-tight mt-2.5 text-[var(--color-brand-ink)] dark:text-[var(--color-text)]">
              ¿Necesitas apoyo financiero?
            </div>
            <div className="text-xs mt-1.5 leading-[1.5] text-[var(--color-brand-ink)]/80 dark:text-[var(--color-text-muted)]">
              Puedes solicitar hasta {cop(3_000_000)} con tasa preferencial. Aprobación en
              24 h.
            </div>
            <div className="mt-3.5">
              <Button size="sm">
                Solicitar préstamo
                <ArrowRight size={14} strokeWidth={1.75} />
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
