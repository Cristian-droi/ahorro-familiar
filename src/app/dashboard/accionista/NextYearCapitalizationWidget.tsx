'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { showToast } from '@/components/ui/Toast';
import { cop } from '@/lib/format';
import { Coins, HelpCircle, Save } from 'lucide-react';

interface NextYearCapitalizationWidgetProps {
  userId: string;
  initialCapitalization: number;
  valorAcciones: number;
  capitalizaciones: number;
  nextYearSharesPercentage: number;
  nextYear: number;
}

export function NextYearCapitalizationWidget({
  userId,
  initialCapitalization,
  valorAcciones,
  capitalizaciones,
  nextYearSharesPercentage,
  nextYear,
}: NextYearCapitalizationWidgetProps) {
  const router = useRouter();
  const [amount, setAmount] = useState<string>(initialCapitalization > 0 ? String(initialCapitalization) : '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fórmulas
  const totalAportes = valorAcciones + capitalizaciones;
  const accionesSiguienteAno = valorAcciones * nextYearSharesPercentage;
  const rawMax = totalAportes - accionesSiguienteAno;
  const maxCapitalization = rawMax > 0 ? rawMax : 0;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount < 0) {
      setError('El monto debe ser un número válido mayor o igual a cero.');
      return;
    }

    if (numericAmount > maxCapitalization) {
      setError(`El monto máximo permitido es ${cop(maxCapitalization)}.`);
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ next_year_capitalization: numericAmount })
        .eq('id', userId);

      if (updateError) {
        throw updateError;
      }

      showToast('success', 'Capitalización del próximo año guardada correctamente');
      router.refresh();
    } catch (err: unknown) {
      console.error('Error saving next year capitalization:', err);
      showToast('error', (err as Error).message || 'Error al guardar la capitalización');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card padding="md" className="border-[var(--color-brand)]/20 bg-[var(--color-brand-soft)]/5">
      <div className="flex items-start gap-3.5 mb-4">
        <div className="w-10 h-10 rounded-[10px] bg-[var(--color-brand-soft)] text-[var(--color-brand)] flex items-center justify-center shrink-0">
          <Coins size={20} strokeWidth={1.75} />
        </div>
        <div className="flex-1 min-w-0 text-left">
          <h3 className="text-[15px] font-bold tracking-tight text-[var(--color-text)]">
            Capitalización para el año siguiente ({nextYear})
          </h3>
          <p className="text-[12px] text-[var(--color-text-subtle)] mt-1">
            Definí tu capitalización voluntaria para el año entrante. Recordá que no puede superar tus aportes de este año menos las acciones obligatorias del año siguiente.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 mb-4 text-left">
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[12px] p-3">
          <span className="text-[10px] font-bold text-[var(--color-text-subtle)] uppercase tracking-wider block">
            Aportes de este año
          </span>
          <span className="text-[14px] font-semibold text-[var(--color-text)] mt-1 block">
            {cop(totalAportes)}
          </span>
        </div>
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[12px] p-3">
          <span className="text-[10px] font-bold text-[var(--color-text-subtle)] uppercase tracking-wider block">
            Acciones {nextYear} ({(nextYearSharesPercentage * 100).toFixed(0)}%)
          </span>
          <span className="text-[14px] font-semibold text-[var(--color-text)] mt-1 block">
            {cop(accionesSiguienteAno)}
          </span>
        </div>
        <div className="bg-[var(--color-surface)] border border-[var(--color-brand)]/20 rounded-[12px] p-3 bg-[var(--color-brand-soft)]/5">
          <span className="text-[10px] font-bold text-[var(--color-brand)] uppercase tracking-wider block">
            Máximo capitalizable
          </span>
          <span className="text-[14px] font-bold text-[var(--color-brand)] mt-1 block">
            {cop(maxCapitalization)}
          </span>
        </div>
      </div>

      <form onSubmit={handleSave} className="flex flex-col gap-3">
        <div className="flex flex-col md:flex-row gap-3 items-end">
          <div className="flex-1 w-full text-left">
            <Input
              type="number"
              placeholder="Ej: 500000"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                if (error) setError(null);
              }}
              error={error || undefined}
              disabled={loading}
              label={`Monto a capitalizar en ${nextYear}`}
            />
          </div>
          <Button
            type="submit"
            disabled={loading || !!error}
            size="md"
            className="h-12 w-full md:w-auto shrink-0"
          >
            <Save size={15} strokeWidth={2} />
            {loading ? 'Guardando...' : 'Guardar'}
          </Button>
        </div>
        <div className="flex items-start gap-1.5 text-[11px] text-[var(--color-text-muted)] text-left pl-1">
          <HelpCircle size={12} className="shrink-0 mt-0.5" />
          <span>
            Dejalo en cero si no querés capitalizar el próximo año. Este valor se descontará de tu devolución anual.
          </span>
        </div>
      </form>
    </Card>
  );
}
