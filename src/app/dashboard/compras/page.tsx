'use client';

// Página de compra de acciones para el accionista.
//
// El accionista arma un "recibo" con una o varias líneas (por ahora solo
// concepto 'acciones'), puede comprar el mes actual, meses futuros del año
// en curso o meses vencidos del año en curso. Por cada mes vencido el
// sistema agrega automáticamente una línea de multa por mora, congelada al
// momento del envío.
//
// Estados:
//   - Sin valor de acción definido → redirige a ajustes.
//   - Con valor de acción → muestra el carrito.
//
// Al enviar, sube el comprobante al bucket 'payment-proofs' bajo
// <user.id>/<uuid>.<ext>, y llama a POST /api/receipts con el path.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { showToast } from '@/components/ui/Toast';
import {
  Plus,
  Trash2,
  AlertTriangle,
  Upload,
  FileText,
  X,
  Info,
  CheckCircle2,
  TrendingUp,
  Lock,
} from 'lucide-react';
import { getProfile } from '@/lib/data/profiles';
import { listReceiptsForUser } from '@/lib/data/receipts';
import {
  getMyCapitalizationState,
  type MyCapState,
} from '@/lib/data/capitalization';
import {
  computeFineForMonth,
  DEFAULT_PURCHASE_RULES,
  getBogotaCurrentMonth,
  getBogotaToday,
  listAllMonthsOfYear,
  type PurchaseRules,
} from '@/lib/fines';
import { cop, monthLabel } from '@/lib/format';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'application/pdf'];

type CartLine = {
  // uid local; no persiste. Lo usamos como key estable del repeater.
  uid: string;
  target_month: string; // 'YYYY-MM-01'
  share_count: number;
};

function makeUid() {
  return Math.random().toString(36).slice(2, 10);
}

function extensionFromMime(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'application/pdf') return 'pdf';
  return 'bin';
}

export default function ComprasPage() {
  const router = useRouter();

  // Datos iniciales del usuario.
  const [userId, setUserId] = useState<string | null>(null);
  const [firstName, setFirstName] = useState<string>('');
  const [shareValue, setShareValue] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // Reglas desde system_settings (min/max acciones, multa, gracia).
  const [rules, setRules] = useState<PurchaseRules>(DEFAULT_PURCHASE_RULES);

  // Meses que ya tienen multa asociada en otros recibos pending/approved
  // del usuario → no se vuelve a cobrar multa al mandar una nueva línea
  // para ese mes. El server hace el chequeo final; esto es preview.
  const [monthsAlreadyFined, setMonthsAlreadyFined] = useState<Set<string>>(
    new Set(),
  );

  // Acciones ya compradas (pending/approved) por mes, para mostrar en
  // vivo cuánto le queda al usuario de su tope mensual. El trigger de DB
  // hace el chequeo definitivo; esto es sólo preview.
  const [sharesAlreadyBoughtByMonth, setSharesAlreadyBoughtByMonth] = useState<
    Map<string, number>
  >(new Map());

  // Estado del carrito.
  const currentMonth = useMemo(() => getBogotaCurrentMonth(), []);
  const [lines, setLines] = useState<CartLine[]>(() => [
    { uid: makeUid(), target_month: getBogotaCurrentMonth(), share_count: 1 },
  ]);

  // Capitalización: estado para ESTE accionista (resuelto en backend —
  // si tiene ventana individual, esa anula la global; si solo hay global,
  // se usa esa). Cuando `capEnabled` es true se agrega una línea
  // adicional al recibo con concepto 'capitalizacion' y el monto libre.
  const [capState, setCapState] = useState<MyCapState | null>(null);
  const [capEnabled, setCapEnabled] = useState(false);
  const [capAmountInput, setCapAmountInput] = useState<string>('');

  // Archivo comprobante.
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [submitting, setSubmitting] = useState(false);

  // Meses seleccionables: todos los meses del año en curso. El trigger de DB
  // filtra si alguien intentara mandar año pasado o próximo.
  const monthOptions = useMemo(() => {
    const year = Number(currentMonth.slice(0, 4));
    return listAllMonthsOfYear(year);
  }, [currentMonth]);

  // Carga inicial: perfil (para valor de acción), reglas de compra y
  // meses ya multados del usuario.
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
      if (cancelled) return;
      setUserId(user.id);

      try {
        const profile = await getProfile(supabase, user.id);
        if (cancelled) return;
        setFirstName(profile.first_name ?? '');

        if (profile.selected_share_value == null) {
          // Sin valor de acción no puede comprar.
          showToast(
            'info',
            'Primero debes elegir tu valor de acción en Ajustes.',
          );
          router.replace('/dashboard/ajustes');
          return;
        }
        setShareValue(Number(profile.selected_share_value));
      } catch (err) {
        console.error('Error cargando perfil:', err);
        showToast('error', 'No se pudo cargar tu perfil.');
      }

      // Reglas.
      try {
        const { data } = await supabase
          .from('system_settings')
          .select('value')
          .eq('key', 'purchase_rules')
          .maybeSingle();
        if (!cancelled && data?.value) {
          const v = data.value as Partial<PurchaseRules>;
          setRules({
            min_shares_per_month:
              v.min_shares_per_month ??
              DEFAULT_PURCHASE_RULES.min_shares_per_month,
            max_shares_per_month:
              v.max_shares_per_month ??
              DEFAULT_PURCHASE_RULES.max_shares_per_month,
            fine_per_day:
              v.fine_per_day ?? DEFAULT_PURCHASE_RULES.fine_per_day,
            fine_max_per_month:
              v.fine_max_per_month ??
              DEFAULT_PURCHASE_RULES.fine_max_per_month,
            grace_period_days:
              v.grace_period_days ??
              DEFAULT_PURCHASE_RULES.grace_period_days,
          });
        }
      } catch {
        /* usa defaults */
      }

      // Para el preview: meses en los que el usuario ya tiene multa
      // pending/approved (en otro recibo). RLS filtra a sus propios
      // recibos al hacer el select anidado.
      try {
        const receipts = await listReceiptsForUser(supabase, user.id);
        const activeReceiptIds = receipts
          .filter((r) => r.status === 'pending' || r.status === 'approved')
          .map((r) => r.id);

        if (activeReceiptIds.length > 0) {
          const { data: fineItems } = await supabase
            .from('receipt_items')
            .select('target_month')
            .eq('concept', 'multa_acciones')
            .in('receipt_id', activeReceiptIds);

          if (!cancelled && fineItems) {
            setMonthsAlreadyFined(
              new Set(fineItems.map((r) => r.target_month)),
            );
          }

          // Totales de acciones previas (pending + approved) por mes.
          // El trigger max_shares_per_month_exceeded usa exactamente esta
          // misma suma + lo nuevo; aquí replicamos el cálculo para poder
          // avisar en vivo.
          const { data: shareItems } = await supabase
            .from('receipt_items')
            .select('target_month, share_count')
            .eq('concept', 'acciones')
            .in('receipt_id', activeReceiptIds);

          if (!cancelled && shareItems) {
            const map = new Map<string, number>();
            for (const it of shareItems) {
              const prev = map.get(it.target_month) ?? 0;
              map.set(it.target_month, prev + (it.share_count ?? 0));
            }
            setSharesAlreadyBoughtByMonth(map);
          }
        }
      } catch (err) {
        console.error('Error cargando multas previas:', err);
      }

      // Estado de capitalización para este accionista (no bloqueante).
      try {
        const state = await getMyCapitalizationState(supabase);
        if (!cancelled) setCapState(state);
      } catch (err) {
        console.error('Error cargando capitalizaciones:', err);
      }

      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  // ===== Derivados del carrito =====

  // Agrupa por mes: sumamos share_count por mes para validar el tope
  // (max_shares_per_month). Una misma línea UI es un target_month + count,
  // pero el usuario podría duplicar el mes en dos líneas.
  const monthTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of lines) {
      map.set(l.target_month, (map.get(l.target_month) ?? 0) + l.share_count);
    }
    return map;
  }, [lines]);

  // Multas por cada mes distinto del carrito (solo si aún no hay multa
  // registrada en otro recibo activo del usuario).
  const fineBreakdown = useMemo(() => {
    const today = getBogotaToday();
    const distinctMonths = Array.from(new Set(lines.map((l) => l.target_month)));
    const out: { month: string; amount: number }[] = [];
    for (const m of distinctMonths) {
      if (monthsAlreadyFined.has(m)) continue;
      const fine = computeFineForMonth(m, today, rules);
      if (fine > 0) out.push({ month: m, amount: fine });
    }
    return out;
  }, [lines, rules, monthsAlreadyFined]);

  const sharesSubtotal = useMemo(() => {
    if (shareValue == null) return 0;
    const totalShares = lines.reduce((s, l) => s + l.share_count, 0);
    return totalShares * shareValue;
  }, [lines, shareValue]);

  const finesSubtotal = useMemo(
    () => fineBreakdown.reduce((s, f) => s + f.amount, 0),
    [fineBreakdown],
  );

  // Monto de capitalización: el input puede venir con separadores/espacios;
  // nos quedamos solo con los dígitos.
  const capAmountParsed = useMemo(() => {
    if (!capEnabled) return 0;
    const digits = capAmountInput.replace(/[^\d]/g, '');
    const n = Number(digits);
    return Number.isFinite(n) ? n : 0;
  }, [capEnabled, capAmountInput]);

  const totalAmount = sharesSubtotal + finesSubtotal + capAmountParsed;

  // ===== Validaciones =====

  // Flag global: alguno de los meses del carrito (sumando lo que el usuario
  // ya compró en recibos pending/approved) supera el tope. No generamos
  // mensaje global para no duplicar — el mensaje va inline por línea.
  const hasMonthOverMax = useMemo(() => {
    for (const [month, total] of monthTotals.entries()) {
      const already = sharesAlreadyBoughtByMonth.get(month) ?? 0;
      if (already + total > rules.max_shares_per_month) return true;
    }
    return false;
  }, [monthTotals, sharesAlreadyBoughtByMonth, rules]);

  // Errores relativos a la sección de acciones: ausencia de líneas,
  // mínimos por línea y tope mensual excedido (este último silencioso
  // porque ya se muestra inline). Se renderiza sólo dentro de la card
  // de acciones, no mezclado con mensajes de capitalización.
  const accionesValidationError: string | null = useMemo(() => {
    // Sólo pedimos agregar una línea si el usuario no está armando una
    // capitalización "sola". Mientras capEnabled esté activo, permitimos
    // que el carrito de acciones quede vacío.
    if (lines.length === 0 && !capEnabled) {
      return 'Agrega al menos una línea de compra.';
    }
    for (const l of lines) {
      if (l.share_count < rules.min_shares_per_month) {
        return `El mínimo por línea es ${rules.min_shares_per_month} ${rules.min_shares_per_month === 1 ? 'acción' : 'acciones'}.`;
      }
    }
    // El exceso por mes se muestra inline en la línea correspondiente;
    // aquí devolvemos '' para bloquear el submit sin duplicar el mensaje.
    if (hasMonthOverMax) return '';
    return null;
  }, [lines, capEnabled, rules, hasMonthOverMax]);

  // Error agregado para el submit. Incluye acciones + capitalización +
  // caso "no hay nada para enviar". El mensaje de capitalización no se
  // pinta en la card de acciones; la propia card de capitalización ya
  // muestra el aviso inline en amarillo.
  const validationError: string | null = useMemo(() => {
    const hasAnything = lines.length > 0 || (capEnabled && capAmountParsed > 0);
    if (!hasAnything) return 'Agrega al menos una línea de compra.';
    if (accionesValidationError != null) return accionesValidationError;
    if (capEnabled) {
      if (capAmountParsed <= 0) {
        return 'Indica el monto a capitalizar.';
      }
      if (!capState?.allowed) {
        return 'La capitalización no está disponible.';
      }
      // Si tiene ventana individual con tope, no permitimos exceder el remaining.
      if (
        capState.allowed &&
        capState.scope === 'user' &&
        capState.remaining != null &&
        capAmountParsed > capState.remaining
      ) {
        return `El monto excede tu cupo (${cop(capState.remaining)} disponibles).`;
      }
    }
    return null;
  }, [
    lines,
    accionesValidationError,
    capEnabled,
    capAmountParsed,
    capState,
  ]);

  // ===== Handlers del carrito =====

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      {
        uid: makeUid(),
        target_month: currentMonth,
        share_count: rules.min_shares_per_month,
      },
    ]);
  };

  const removeLine = (uid: string) => {
    setLines((prev) => {
      // Permitimos vaciar el carrito de acciones sólo si el usuario está
      // armando una capitalización en este mismo recibo. No exigimos que
      // ya tenga monto digitado: la card de capitalización muestra su
      // propio aviso para que complete el campo.
      if (prev.length <= 1 && !capEnabled) {
        return prev;
      }
      return prev.filter((l) => l.uid !== uid);
    });
  };

  const updateLine = (uid: string, patch: Partial<CartLine>) => {
    setLines((prev) =>
      prev.map((l) => (l.uid === uid ? { ...l, ...patch } : l)),
    );
  };

  // ===== Handlers del archivo =====

  const handleFileChange = useCallback((f: File | null) => {
    setFileError(null);
    if (!f) {
      setFile(null);
      return;
    }
    if (!ALLOWED_MIME.includes(f.type)) {
      setFileError('Formato no permitido. Usa JPG, PNG o PDF.');
      setFile(null);
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      setFileError('El archivo supera 5 MB.');
      setFile(null);
      return;
    }
    setFile(f);
  }, []);

  const clearFile = () => {
    setFile(null);
    setFileError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ===== Envío =====

  const handleSubmit = async () => {
    if (!userId || shareValue == null) return;
    if (validationError != null) {
      if (validationError === '') {
        showToast(
          'error',
          `Una o más líneas superan el máximo de ${rules.max_shares_per_month} acciones por mes.`,
        );
      } else {
        showToast('error', validationError);
      }
      return;
    }
    if (!file) {
      showToast('error', 'Adjunta el comprobante de pago.');
      return;
    }

    setSubmitting(true);
    try {
      // 1) Subir comprobante.
      const ext = extensionFromMime(file.type);
      const path = `${userId}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('payment-proofs')
        .upload(path, file, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) {
        console.error('Upload error:', uploadError);
        showToast('error', 'No se pudo subir el comprobante.');
        setSubmitting(false);
        return;
      }

      // 2) Crear recibo. Se pueden mezclar líneas 'acciones' con una única
      // línea 'capitalizacion' (el schema del backend lo valida).
      const items: Array<
        | {
            concept: 'acciones';
            target_month: string;
            share_count: number;
          }
        | {
            concept: 'capitalizacion';
            target_month: string;
            amount: number;
          }
      > = lines.map((l) => ({
        concept: 'acciones' as const,
        target_month: l.target_month,
        share_count: l.share_count,
      }));

      if (capEnabled && capAmountParsed > 0) {
        items.push({
          concept: 'capitalizacion' as const,
          target_month: currentMonth,
          amount: capAmountParsed,
        });
      }

      const payload = {
        items,
        payment_proof_path: path,
      };

      const res = await fetch('/api/receipts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();

      if (!res.ok) {
        // Si falló, intentamos borrar el archivo recién subido para no
        // dejar huérfanos.
        await supabase.storage.from('payment-proofs').remove([path]);
        showToast('error', json?.error ?? 'No se pudo registrar la compra.');
        setSubmitting(false);
        return;
      }

      showToast(
        'success',
        `Recibo ${json?.receipt?.receipt_number ?? ''} enviado. Queda en revisión.`,
      );
      // Reset local; redirige al historial.
      router.push('/dashboard/historial');
    } catch (err) {
      console.error('Submit error:', err);
      showToast('error', 'Ocurrió un error al enviar el recibo.');
      setSubmitting(false);
    }
  };

  // ===== Render =====

  if (loading) {
    return (
      <div className="animate-pulse text-[var(--color-text-subtle)] text-sm">
        Cargando…
      </div>
    );
  }

  if (shareValue == null) {
    return null; // Redirigiendo.
  }

  return (
    <div className="flex flex-col gap-7 animate-in fade-in duration-300">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-5">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.025em] leading-[1.15]">
            Comprar acciones
          </h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1.5 max-w-xl">
            {firstName ? `${firstName}, ` : ''}arma tu recibo con los meses
            que quieras pagar y adjunta el comprobante de la transferencia.
          </p>
        </div>
        <div className="flex items-center gap-2.5 self-start md:self-auto">
          <Badge tone="brand" dot>
            Valor acción: {cop(shareValue)}
          </Badge>
          <Badge tone="neutral">
            Mes actual: {monthLabel(currentMonth, true)}
          </Badge>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6 items-start">
        {/* Columna principal */}
        <div className="flex flex-col gap-5">
          {/* Líneas del carrito */}
          <Card padding="lg">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-[15px] font-semibold tracking-tight">
                  Meses y acciones
                </h2>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                  Mínimo {rules.min_shares_per_month}, máximo {rules.max_shares_per_month} acciones por mes.
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={addLine}
                disabled={lines.length >= 12}
              >
                <Plus size={15} strokeWidth={1.75} />
                Agregar mes
              </Button>
            </div>

            <div className="flex flex-col gap-2.5">
              {lines.map((l) => {
                const isPast = l.target_month < currentMonth;
                const isFuture = l.target_month > currentMonth;
                const alreadyFined = monthsAlreadyFined.has(l.target_month);
                const alreadyBought =
                  sharesAlreadyBoughtByMonth.get(l.target_month) ?? 0;
                const totalForThisMonth = monthTotals.get(l.target_month) ?? 0;
                const effectiveTotal = alreadyBought + totalForThisMonth;
                const remainingCapacity = Math.max(
                  0,
                  rules.max_shares_per_month - alreadyBought,
                );
                const overMax = effectiveTotal > rules.max_shares_per_month;
                const excessBy = overMax
                  ? effectiveTotal - rules.max_shares_per_month
                  : 0;
                const lineSubtotal = l.share_count * (shareValue ?? 0);

                return (
                  <div
                    key={l.uid}
                    className={`flex flex-col gap-2 p-3 rounded-[10px] border ${
                      overMax
                        ? 'border-[var(--color-danger)] bg-[var(--color-danger-soft)]/30'
                        : 'border-[var(--color-border)] bg-[var(--color-surface-alt)]'
                    }`}
                  >
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_140px_140px_36px] items-center gap-3">
                    {/* Mes */}
                    <div className="flex flex-col gap-1 min-w-0">
                      <label className="text-[10px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase">
                        Mes
                      </label>
                      <select
                        value={l.target_month}
                        onChange={(e) =>
                          updateLine(l.uid, { target_month: e.target.value })
                        }
                        className="h-10 rounded-[9px] bg-[var(--color-surface)] border border-[var(--color-border)] px-2.5 text-[13px] font-medium text-[var(--color-text)] focus:outline-none focus:border-[var(--color-brand)]"
                      >
                        {monthOptions.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        {isPast && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--color-warn)]">
                            <AlertTriangle size={10} strokeWidth={2} />
                            {alreadyFined ? 'Multa ya cobrada' : 'Mes en mora'}
                          </span>
                        )}
                        {isFuture && (
                          <span className="text-[10px] font-semibold text-[var(--color-info)]">
                            Adelantado
                          </span>
                        )}
                      </div>
                    </div>

                    {/* # acciones */}
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase">
                        Acciones
                      </label>
                      <div className="flex items-center h-10 rounded-[9px] bg-[var(--color-surface)] border border-[var(--color-border)]">
                        <button
                          type="button"
                          onClick={() =>
                            updateLine(l.uid, {
                              share_count: Math.max(
                                rules.min_shares_per_month,
                                l.share_count - 1,
                              ),
                            })
                          }
                          className="w-9 h-full flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
                          aria-label="Menos"
                        >
                          −
                        </button>
                        <input
                          type="number"
                          min={rules.min_shares_per_month}
                          max={rules.max_shares_per_month}
                          value={l.share_count}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            if (Number.isFinite(v)) {
                              updateLine(l.uid, {
                                share_count: Math.max(
                                  1,
                                  Math.min(rules.max_shares_per_month, Math.floor(v)),
                                ),
                              });
                            }
                          }}
                          className="flex-1 h-full w-full text-center bg-transparent text-[14px] font-semibold text-[var(--color-text)] focus:outline-none tabular"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            updateLine(l.uid, {
                              share_count: Math.min(
                                rules.max_shares_per_month,
                                l.share_count + 1,
                              ),
                            })
                          }
                          className="w-9 h-full flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
                          aria-label="Más"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    {/* Subtotal */}
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase">
                        Subtotal
                      </label>
                      <div className="h-10 flex items-center text-[14px] font-semibold tabular">
                        {cop(lineSubtotal)}
                      </div>
                    </div>

                    {/* Remover */}
                    <div className="flex md:justify-center items-end h-full">
                      <button
                        type="button"
                        onClick={() => removeLine(l.uid)}
                        disabled={lines.length === 1 && !capEnabled}
                        title="Quitar línea"
                        aria-label="Quitar línea"
                        className="w-9 h-10 rounded-[9px] flex items-center justify-center text-[var(--color-text-subtle)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                      >
                        <Trash2 size={15} strokeWidth={1.75} />
                      </button>
                    </div>
                    </div>

                    {/* Mensaje inline de tope excedido (mes en específico). */}
                    {overMax ? (
                      <div className="flex items-start gap-2 text-[12px] font-medium text-[var(--color-danger)]">
                        <AlertTriangle
                          size={13}
                          strokeWidth={2}
                          className="mt-px shrink-0"
                        />
                        <span>
                          {alreadyBought > 0 ? (
                            <>
                              Ya tienes <strong>{alreadyBought}</strong>{' '}
                              {alreadyBought === 1 ? 'acción' : 'acciones'} en
                              recibos previos para{' '}
                              {monthLabel(l.target_month, true)}. Máximo{' '}
                              {rules.max_shares_per_month} por mes; te{' '}
                              {remainingCapacity === 0
                                ? 'no queda cupo disponible'
                                : `quedan ${remainingCapacity} disponibles`}
                              . Excede por {excessBy}.
                            </>
                          ) : (
                            <>
                              Este mes excede el máximo de{' '}
                              {rules.max_shares_per_month} acciones por{' '}
                              {excessBy}.
                            </>
                          )}
                        </span>
                      </div>
                    ) : alreadyBought > 0 ? (
                      <div className="text-[11px] text-[var(--color-text-subtle)]">
                        Ya compraste <strong>{alreadyBought}</strong>{' '}
                        {alreadyBought === 1 ? 'acción' : 'acciones'} para{' '}
                        {monthLabel(l.target_month, true)}. Te quedan{' '}
                        {remainingCapacity} disponibles.
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {accionesValidationError ? (
              <div className="mt-3 flex items-start gap-2 text-[12px] font-medium text-[var(--color-danger)]">
                <AlertTriangle size={14} strokeWidth={2} className="mt-px shrink-0" />
                {accionesValidationError}
              </div>
            ) : null}
          </Card>

          {/* Capitalización (opcional, solo si la ventana está abierta) */}
          <CapitalizationSection
            state={capState}
            enabled={capEnabled}
            setEnabled={setCapEnabled}
            amountInput={capAmountInput}
            setAmountInput={setCapAmountInput}
            amountParsed={capAmountParsed}
            currentMonth={currentMonth}
          />

          {/* Multas (preview) */}
          {fineBreakdown.length > 0 && (
            <Card padding="lg" className="border-[var(--color-warn)]/60">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-[var(--color-warn-soft)] text-[var(--color-warn)] flex items-center justify-center shrink-0">
                  <AlertTriangle size={16} strokeWidth={1.75} />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-[15px] font-semibold tracking-tight">
                    Multas por mora
                  </h2>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                    Se agregan automáticamente al recibo y se congelan al
                    momento de enviarlo (no suben aunque la revisión tarde).
                  </p>

                  <ul className="mt-3 flex flex-col divide-y divide-[var(--color-border)]">
                    {fineBreakdown.map((f) => (
                      <li
                        key={f.month}
                        className="py-2 flex items-center justify-between gap-3 text-[13px]"
                      >
                        <span className="text-[var(--color-text)] font-medium">
                          {monthLabel(f.month, true)}
                        </span>
                        <span className="font-semibold text-[var(--color-warn)] tabular">
                          + {cop(f.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Card>
          )}

          {/* Subida de comprobante */}
          <Card padding="lg">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-[var(--color-info-soft)] text-[var(--color-info)] flex items-center justify-center">
                <Upload size={16} strokeWidth={1.75} />
              </div>
              <div>
                <h2 className="text-[15px] font-semibold tracking-tight">
                  Comprobante de pago
                </h2>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                  JPG, PNG o PDF. Máximo 5 MB.
                </p>
              </div>
            </div>

            {!file ? (
              <label
                htmlFor="payment-proof-input"
                className={`flex flex-col items-center justify-center gap-2 h-36 rounded-[12px] border border-dashed cursor-pointer transition-colors ${
                  fileError
                    ? 'border-[var(--color-danger)] bg-[var(--color-danger-soft)]/30'
                    : 'border-[var(--color-border)] bg-[var(--color-surface-alt)] hover:bg-[var(--color-surface)]'
                }`}
              >
                <Upload size={22} strokeWidth={1.5} className="text-[var(--color-text-subtle)]" />
                <span className="text-[13px] font-semibold text-[var(--color-text)]">
                  Haz clic para seleccionar un archivo
                </span>
                <span className="text-[11px] text-[var(--color-text-subtle)]">
                  o arrástralo aquí
                </span>
                <input
                  id="payment-proof-input"
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,application/pdf"
                  className="hidden"
                  onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
                />
              </label>
            ) : (
              <div className="flex items-center gap-3 p-3.5 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-alt)]">
                <div className="w-10 h-10 rounded-[8px] bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-text-muted)] shrink-0">
                  <FileText size={18} strokeWidth={1.75} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-[var(--color-text)] truncate">
                    {file.name}
                  </div>
                  <div className="text-[11px] text-[var(--color-text-subtle)]">
                    {(file.size / 1024).toFixed(0)} KB · {file.type || 'archivo'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={clearFile}
                  className="w-8 h-8 rounded-[8px] flex items-center justify-center text-[var(--color-text-subtle)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)] cursor-pointer transition-colors"
                  aria-label="Quitar archivo"
                >
                  <X size={16} strokeWidth={1.75} />
                </button>
              </div>
            )}

            {fileError && (
              <div className="mt-2 flex items-center gap-2 text-[12px] font-medium text-[var(--color-danger)]">
                <AlertTriangle size={13} strokeWidth={2} />
                {fileError}
              </div>
            )}
          </Card>
        </div>

        {/* Resumen lateral */}
        <aside className="lg:sticky lg:top-4">
          <Card padding="lg">
            <h2 className="text-[15px] font-semibold tracking-tight mb-3.5">
              Resumen del recibo
            </h2>

            <div className="flex flex-col gap-2.5 text-[13px]">
              <div className="flex items-center justify-between">
                <span className="text-[var(--color-text-muted)]">Acciones</span>
                <span className="font-semibold tabular">{cop(sharesSubtotal)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--color-text-muted)]">Multas</span>
                <span
                  className={`font-semibold tabular ${
                    finesSubtotal > 0 ? 'text-[var(--color-warn)]' : ''
                  }`}
                >
                  {finesSubtotal > 0 ? '+ ' : ''}
                  {cop(finesSubtotal)}
                </span>
              </div>
              {capEnabled && (
                <div className="flex items-center justify-between">
                  <span className="text-[var(--color-text-muted)]">
                    Capitalización
                  </span>
                  <span
                    className={`font-semibold tabular ${
                      capAmountParsed > 0 ? 'text-[var(--color-success)]' : ''
                    }`}
                  >
                    {capAmountParsed > 0 ? '+ ' : ''}
                    {cop(capAmountParsed)}
                  </span>
                </div>
              )}
            </div>

            <div className="my-4 h-px bg-[var(--color-border)]" />

            <div className="flex items-end justify-between gap-3">
              <span className="text-[12px] font-semibold text-[var(--color-text-muted)] tracking-wider uppercase">
                Total a pagar
              </span>
              <span className="text-[22px] font-semibold tracking-[-0.02em] tabular">
                {cop(totalAmount)}
              </span>
            </div>

            <Button
              variant="primary"
              size="lg"
              className="w-full mt-5"
              disabled={submitting || validationError != null || !file}
              onClick={handleSubmit}
            >
              {submitting ? (
                'Enviando…'
              ) : (
                <>
                  <CheckCircle2 size={16} strokeWidth={2} />
                  Enviar recibo
                </>
              )}
            </Button>

            <p className="text-[11px] text-[var(--color-text-subtle)] mt-3 leading-snug">
              Se asignará un número RC-NNNNN y quedará pendiente de revisión.
              Recibirás confirmación cuando el administrador lo apruebe.
            </p>
          </Card>

          <div className="mt-3 flex items-start gap-2 text-[11px] text-[var(--color-text-subtle)] px-1">
            <Info size={12} strokeWidth={1.75} className="mt-0.5 shrink-0" />
            <span>
              Tu valor de acción se bloquea cuando el administrador aprueba
              tu primera compra de acciones del año.
            </span>
          </div>
        </aside>
      </div>
    </div>
  );
}

// =============================================================================
// Sección de capitalización (accionista)
//
// Tres estados visuales:
//   1. Ventana abierta + no habilitada → botón "Agregar capitalización".
//   2. Ventana abierta + habilitada   → input de monto + progreso + botón X.
//   3. Ventana cerrada               → card deshabilitada ("No disponible").
// =============================================================================
function CapitalizationSection({
  state,
  enabled,
  setEnabled,
  amountInput,
  setAmountInput,
  amountParsed,
  currentMonth,
}: {
  state: MyCapState | null;
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  amountInput: string;
  setAmountInput: (v: string) => void;
  amountParsed: number;
  currentMonth: string;
}) {
  // Mientras no haya respuesta del RPC, no renderizamos nada (evita flash de
  // "no disponible" cuando en realidad sí está abierta).
  if (!state) return null;

  // Cerrada → card compacta deshabilitada.
  if (!state.allowed) {
    return (
      <Card padding="lg" className="opacity-70">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] flex items-center justify-center shrink-0">
            <Lock size={16} strokeWidth={1.75} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[15px] font-semibold tracking-tight text-[var(--color-text-muted)]">
              Capitalización
            </h2>
            <p className="text-[12px] text-[var(--color-text-subtle)] mt-0.5">
              No disponible por ahora.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  // Abierta. Mostramos info de la ventana — distinta según scope.
  const isUserScope = state.scope === 'user';
  const remaining = state.remaining ?? 0;
  const max = state.max_amount ?? 0;
  const pct = isUserScope && max > 0 ? Math.min(100, ((max - remaining) / max) * 100) : 0;
  const exceeds =
    isUserScope && state.remaining != null && amountParsed > state.remaining;

  return (
    <Card padding="lg">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-[var(--color-success-soft)] text-[var(--color-success)] flex items-center justify-center shrink-0">
          <TrendingUp size={16} strokeWidth={1.75} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-[15px] font-semibold tracking-tight">
              Capitalización
            </h2>
            {isUserScope ? (
              <span className="text-[10px] font-semibold text-[var(--color-brand)] bg-[var(--color-brand-soft)] px-1.5 py-0.5 rounded uppercase tracking-wider">
                Personal
              </span>
            ) : null}
          </div>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            {isUserScope
              ? `Aporte opcional. Se asocia a ${monthLabel(currentMonth, true)}.`
              : `Aporte opcional, en monto libre. Se asocia a ${monthLabel(currentMonth, true)}.`}
          </p>
        </div>
      </div>

      {/* Info de la ventana individual: progreso del cupo */}
      {isUserScope && (
        <div className="mb-4">
          <div className="flex items-center justify-between text-[11px] text-[var(--color-text-muted)] mb-1.5">
            <span>
              Cupo usado {cop(state.used ?? 0)} de {cop(max)}
            </span>
            <span className="font-semibold tabular">
              {pct.toFixed(pct % 1 === 0 ? 0 : 1)} %
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-[var(--color-surface-alt)] overflow-hidden">
            <div
              className="h-full bg-[var(--color-success)] transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="text-[11px] text-[var(--color-text-subtle)] mt-1.5">
            Cierra el {state.deadline}. Disponible para capitalizar:{' '}
            <span className="font-semibold text-[var(--color-text)] tabular">
              {cop(remaining)}
            </span>
            .
          </div>
        </div>
      )}

      {/* Info de la ventana global */}
      {!isUserScope && (
        <div className="mb-4 text-[11px] text-[var(--color-text-subtle)]">
          Cierra el {state.deadline}. Sin tope individual.
        </div>
      )}

      {!enabled ? (
        <Button
          variant="secondary"
          size="md"
          onClick={() => setEnabled(true)}
        >
          <Plus size={15} strokeWidth={1.75} />
          Agregar capitalización a este recibo
        </Button>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="text-[10px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase">
            Monto a capitalizar (COP)
          </label>
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center h-10 rounded-[9px] bg-[var(--color-surface)] border border-[var(--color-border)] px-3">
              <span className="text-[13px] text-[var(--color-text-subtle)] mr-1.5">
                $
              </span>
              <input
                type="text"
                inputMode="numeric"
                placeholder="Ej. 100000"
                value={amountInput}
                onChange={(e) => {
                  // Guardamos solo dígitos + renderizamos con separadores.
                  const digits = e.target.value.replace(/[^\d]/g, '');
                  if (digits === '') {
                    setAmountInput('');
                  } else {
                    setAmountInput(
                      new Intl.NumberFormat('es-CO').format(Number(digits)),
                    );
                  }
                }}
                className="flex-1 bg-transparent text-[14px] font-semibold text-[var(--color-text)] focus:outline-none tabular"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setEnabled(false);
                setAmountInput('');
              }}
              className="w-10 h-10 rounded-[9px] flex items-center justify-center text-[var(--color-text-subtle)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)] cursor-pointer transition-colors"
              title="Quitar capitalización"
              aria-label="Quitar capitalización"
            >
              <Trash2 size={15} strokeWidth={1.75} />
            </button>
          </div>
          {amountParsed > 0 && (
            <div className="text-[11px] text-[var(--color-text-muted)]">
              Monto a capitalizar:{' '}
              <span className="font-semibold text-[var(--color-text)] tabular">
                {cop(amountParsed)}
              </span>
            </div>
          )}
          {enabled && amountParsed === 0 && (
            <div className="flex items-start gap-2 text-[11px] text-[var(--color-warn)]">
              <AlertTriangle size={12} strokeWidth={2} className="mt-px shrink-0" />
              Indica un monto mayor a cero o quita esta línea.
            </div>
          )}
          {exceeds && (
            <div className="flex items-start gap-2 text-[11px] text-[var(--color-danger)]">
              <AlertTriangle size={12} strokeWidth={2} className="mt-px shrink-0" />
              Excede tu cupo personal ({cop(state.remaining ?? 0)} disponibles).
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
