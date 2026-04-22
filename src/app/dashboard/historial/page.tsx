'use client';

// Historial de transacciones del accionista.
//
// Muestra todos los recibos del usuario autenticado (pending, approved,
// rejected) con sus líneas, el comprobante y — para los rechazados — un
// panel de edición que reenvía al backend vía POST /api/receipts/[id]/resubmit.
//
// Notas de diseño:
//   - Los meses y líneas 'acciones' son editables; las multas se recalculan
//     automáticamente al reenviar, por eso no se muestran editables.
//   - El comprobante anterior puede conservarse (re-subiendo el mismo
//     archivo no es posible desde acá, así que obligamos a subir uno
//     nuevo siempre — evita ambigüedad sobre si se mantiene o no).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { showToast } from '@/components/ui/Toast';
import {
  Receipt,
  ChevronDown,
  ChevronUp,
  FileText,
  AlertTriangle,
  Upload,
  Plus,
  Trash2,
  X,
  CheckCircle2,
  RefreshCw,
  Download,
  FileSpreadsheet,
  FileDown,
} from 'lucide-react';
import { exportToExcel, exportToPdf, type ExportSection } from '@/lib/exports';
import { getProfile } from '@/lib/data/profiles';
import {
  computeFineForMonth,
  DEFAULT_PURCHASE_RULES,
  getBogotaCurrentMonth,
  getBogotaToday,
  listAllMonthsOfYear,
  type PurchaseRules,
} from '@/lib/fines';
import {
  cop,
  conceptLabel,
  formatDateTime,
  monthLabel,
  receiptStatusLabel,
  rejectionReasonLabel,
} from '@/lib/format';
import type {
  ReceiptItem,
  ReceiptWithItems,
  ReceiptStatus,
} from '@/types/entities';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'application/pdf'];

type EditLine = {
  uid: string;
  target_month: string;
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

function statusTone(status: ReceiptStatus): 'warn' | 'success' | 'danger' {
  if (status === 'pending') return 'warn';
  if (status === 'approved') return 'success';
  return 'danger';
}

export default function HistorialPage() {
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  const [shareValue, setShareValue] = useState<number | null>(null);
  const [rules, setRules] = useState<PurchaseRules>(DEFAULT_PURCHASE_RULES);
  const [receipts, setReceipts] = useState<ReceiptWithItems[]>([]);
  const [loading, setLoading] = useState(true);

  // UI state
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null); // receipt.id
  const [editLines, setEditLines] = useState<EditLine[]>([]);
  const [editFile, setEditFile] = useState<File | null>(null);
  const [editFileError, setEditFileError] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const editFileInputRef = useRef<HTMLInputElement>(null);

  const currentMonth = useMemo(() => getBogotaCurrentMonth(), []);
  const monthOptions = useMemo(() => {
    const year = Number(currentMonth.slice(0, 4));
    return listAllMonthsOfYear(year);
  }, [currentMonth]);

  // Meses ya multados por el usuario (para preview al editar). No
  // excluimos el recibo en edición — el backend lo hará; sobreestimamos
  // ligeramente el set "ya multado" en el preview, lo cual solo hace
  // que la multa NO aparezca en el preview de edición. Esto puede
  // confundir, así que la recalculamos por recibo: ver buildEditFinePreview.
  const [monthsFinedElsewhere, setMonthsFinedElsewhere] = useState<
    Map<string, Set<string>>
  >(new Map());

  const fetchReceipts = useCallback(
    async (uid: string) => {
      const { data, error } = await supabase
        .from('receipts')
        .select(
          'id, receipt_number, user_id, status, submitted_at, reviewed_at, reviewed_by, rejection_reason, rejection_note, payment_proof_path, total_amount, created_at, updated_at, receipt_items(*)',
        )
        .eq('user_id', uid)
        .order('submitted_at', { ascending: false });

      if (error) {
        console.error('Error cargando recibos:', error);
        showToast('error', 'No se pudo cargar el historial.');
        return;
      }

      const mapped = (data ?? []).map((r) => ({
        ...r,
        items: (r.receipt_items ?? []) as ReceiptItem[],
      })) as ReceiptWithItems[];

      setReceipts(mapped);

      // Para cada recibo rechazado, precalculamos qué meses ya tienen
      // multa en OTROS recibos pending/approved del usuario. Eso nos
      // permite mostrar el preview correcto al editar.
      const elsewhereByReceipt = new Map<string, Set<string>>();
      const activeFineItems = mapped
        .filter((r) => r.status === 'pending' || r.status === 'approved')
        .flatMap((r) =>
          r.items
            .filter((it) => it.concept === 'multa_acciones')
            .map((it) => ({ receiptId: r.id, month: it.target_month })),
        );

      for (const r of mapped) {
        if (r.status !== 'rejected') continue;
        const set = new Set<string>();
        for (const fi of activeFineItems) {
          if (fi.receiptId !== r.id) set.add(fi.month);
        }
        elsewhereByReceipt.set(r.id, set);
      }
      setMonthsFinedElsewhere(elsewhereByReceipt);
    },
    [],
  );

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
        if (profile.selected_share_value != null) {
          setShareValue(Number(profile.selected_share_value));
        }
      } catch (err) {
        console.error('Error perfil:', err);
      }

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
              v.min_shares_per_month ?? DEFAULT_PURCHASE_RULES.min_shares_per_month,
            max_shares_per_month:
              v.max_shares_per_month ?? DEFAULT_PURCHASE_RULES.max_shares_per_month,
            fine_per_day: v.fine_per_day ?? DEFAULT_PURCHASE_RULES.fine_per_day,
            fine_max_per_month:
              v.fine_max_per_month ?? DEFAULT_PURCHASE_RULES.fine_max_per_month,
            grace_period_days:
              v.grace_period_days ?? DEFAULT_PURCHASE_RULES.grace_period_days,
          });
        }
      } catch {
        /* defaults */
      }

      await fetchReceipts(user.id);

      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [router, fetchReceipts]);

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openProof = async (path: string | null) => {
    if (!path) return;
    const { data, error } = await supabase.storage
      .from('payment-proofs')
      .createSignedUrl(path, 60);
    if (error || !data?.signedUrl) {
      showToast('error', 'No se pudo abrir el comprobante.');
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  // ===== Edición / reenvío =====

  const startEdit = (r: ReceiptWithItems) => {
    const acciones = r.items
      .filter((it) => it.concept === 'acciones')
      .map((it) => ({
        uid: makeUid(),
        target_month: it.target_month,
        share_count: it.share_count ?? rules.min_shares_per_month,
      }));
    setEditing(r.id);
    setEditLines(
      acciones.length > 0
        ? acciones
        : [
            {
              uid: makeUid(),
              target_month: currentMonth,
              share_count: rules.min_shares_per_month,
            },
          ],
    );
    setEditFile(null);
    setEditFileError(null);
    if (editFileInputRef.current) editFileInputRef.current.value = '';
  };

  const cancelEdit = () => {
    setEditing(null);
    setEditLines([]);
    setEditFile(null);
    setEditFileError(null);
  };

  const editMonthTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of editLines) {
      map.set(l.target_month, (map.get(l.target_month) ?? 0) + l.share_count);
    }
    return map;
  }, [editLines]);

  // Preview de multas durante la edición: suma los meses distintos del
  // carrito, excluyendo los que ya tienen multa en OTROS recibos del
  // usuario (pending/approved distintos de este).
  const editFinePreview = useMemo(() => {
    if (!editing) return [] as { month: string; amount: number }[];
    const fined = monthsFinedElsewhere.get(editing) ?? new Set<string>();
    const today = getBogotaToday();
    const distinct = Array.from(new Set(editLines.map((l) => l.target_month)));
    const out: { month: string; amount: number }[] = [];
    for (const m of distinct) {
      if (fined.has(m)) continue;
      const fine = computeFineForMonth(m, today, rules);
      if (fine > 0) out.push({ month: m, amount: fine });
    }
    return out;
  }, [editing, editLines, monthsFinedElsewhere, rules]);

  const editSharesSubtotal = useMemo(() => {
    if (shareValue == null) return 0;
    return editLines.reduce((s, l) => s + l.share_count, 0) * shareValue;
  }, [editLines, shareValue]);

  const editFinesSubtotal = useMemo(
    () => editFinePreview.reduce((s, f) => s + f.amount, 0),
    [editFinePreview],
  );

  const editValidationError: string | null = useMemo(() => {
    if (editLines.length === 0) return 'Agrega al menos una línea.';
    for (const l of editLines) {
      if (l.share_count < rules.min_shares_per_month) {
        return `El mínimo por línea es ${rules.min_shares_per_month}.`;
      }
    }
    for (const [month, total] of editMonthTotals.entries()) {
      if (total > rules.max_shares_per_month) {
        return `${monthLabel(month)} excede el máximo (${rules.max_shares_per_month}).`;
      }
    }
    return null;
  }, [editLines, editMonthTotals, rules]);

  const addEditLine = () => {
    setEditLines((prev) => [
      ...prev,
      {
        uid: makeUid(),
        target_month: currentMonth,
        share_count: rules.min_shares_per_month,
      },
    ]);
  };

  const removeEditLine = (uid: string) => {
    setEditLines((prev) =>
      prev.length > 1 ? prev.filter((l) => l.uid !== uid) : prev,
    );
  };

  const updateEditLine = (uid: string, patch: Partial<EditLine>) => {
    setEditLines((prev) =>
      prev.map((l) => (l.uid === uid ? { ...l, ...patch } : l)),
    );
  };

  const handleEditFileChange = (f: File | null) => {
    setEditFileError(null);
    if (!f) {
      setEditFile(null);
      return;
    }
    if (!ALLOWED_MIME.includes(f.type)) {
      setEditFileError('Formato no permitido. Usa JPG, PNG o PDF.');
      setEditFile(null);
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      setEditFileError('El archivo supera 5 MB.');
      setEditFile(null);
      return;
    }
    setEditFile(f);
  };

  const submitResubmit = async () => {
    if (!editing || !userId) return;
    if (editValidationError) {
      showToast('error', editValidationError);
      return;
    }
    if (!editFile) {
      showToast('error', 'Adjunta un nuevo comprobante.');
      return;
    }

    setSubmittingId(editing);
    try {
      const ext = extensionFromMime(editFile.type);
      const path = `${userId}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('payment-proofs')
        .upload(path, editFile, {
          contentType: editFile.type,
          upsert: false,
        });

      if (uploadError) {
        console.error('Upload error:', uploadError);
        showToast('error', 'No se pudo subir el comprobante.');
        setSubmittingId(null);
        return;
      }

      const payload = {
        items: editLines.map((l) => ({
          concept: 'acciones' as const,
          target_month: l.target_month,
          share_count: l.share_count,
        })),
        payment_proof_path: path,
      };

      const res = await fetch(`/api/receipts/${editing}/resubmit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();

      if (!res.ok) {
        await supabase.storage.from('payment-proofs').remove([path]);
        showToast('error', json?.error ?? 'No se pudo reenviar.');
        setSubmittingId(null);
        return;
      }

      showToast('success', 'Recibo reenviado. Queda pendiente de revisión.');
      cancelEdit();
      await fetchReceipts(userId);
    } catch (err) {
      console.error('Resubmit error:', err);
      showToast('error', 'Error al reenviar el recibo.');
    } finally {
      setSubmittingId(null);
    }
  };

  // ===== Export =====

  const handleExport = async (format: 'xlsx' | 'pdf') => {
    if (receipts.length === 0) return;
    setExporting(true);
    try {
      // Hoja 1: resumen de recibos.
      const receiptsSection: ExportSection = {
        name: 'Recibos',
        title: 'Recibos',
        columns: [
          { header: 'Número', key: 'number', width: 14 },
          { header: 'Fecha envío', key: 'submitted', width: 22 },
          { header: 'Estado', key: 'status', width: 14 },
          { header: 'Líneas', key: 'lines', width: 8, align: 'center' },
          { header: 'Total', key: 'total', width: 16, align: 'right' },
          { header: 'Revisado', key: 'reviewed', width: 22 },
          { header: 'Motivo rechazo', key: 'reason', width: 28 },
        ],
        rows: receipts.map((r) => ({
          number: r.receipt_number ?? '—',
          submitted: formatDateTime(r.submitted_at),
          status: receiptStatusLabel(r.status),
          lines: r.items.length,
          total: cop(Number(r.total_amount)),
          reviewed: r.reviewed_at ? formatDateTime(r.reviewed_at) : '',
          reason:
            r.rejection_reason
              ? rejectionReasonLabel(r.rejection_reason) +
                (r.rejection_note ? ` — ${r.rejection_note}` : '')
              : '',
        })),
        totals: {
          label: 'Total',
          values: {
            total: cop(
              receipts.reduce((s, r) => s + Number(r.total_amount ?? 0), 0),
            ),
          },
        },
      };

      // Hoja 2: líneas detalladas.
      const itemsRows = receipts.flatMap((r) =>
        r.items.map((it) => ({
          number: r.receipt_number ?? '—',
          status: receiptStatusLabel(r.status),
          concept: conceptLabel(it.concept),
          month: monthLabel(it.target_month, true),
          shares: it.share_count ?? '',
          unit_value: it.unit_value ? cop(Number(it.unit_value)) : '',
          amount: cop(Number(it.amount)),
          auto: it.auto_generated ? 'Sí' : 'No',
        })),
      );

      const itemsSection: ExportSection = {
        name: 'Detalle',
        title: 'Detalle por línea',
        columns: [
          { header: 'Recibo', key: 'number', width: 14 },
          { header: 'Estado', key: 'status', width: 14 },
          { header: 'Concepto', key: 'concept', width: 22 },
          { header: 'Mes', key: 'month', width: 18 },
          { header: 'Acciones', key: 'shares', width: 10, align: 'center' },
          { header: 'Valor acción', key: 'unit_value', width: 16, align: 'right' },
          { header: 'Monto', key: 'amount', width: 16, align: 'right' },
          { header: 'Auto', key: 'auto', width: 8, align: 'center' },
        ],
        rows: itemsRows,
      };

      const meta = {
        title: 'Historial de transacciones',
        subtitle: 'Tus recibos de compra de acciones',
      };
      const filename = `historial-${new Date().toISOString().slice(0, 10)}`;

      if (format === 'xlsx') {
        await exportToExcel(filename, meta, [receiptsSection, itemsSection]);
      } else {
        await exportToPdf(filename, meta, [receiptsSection, itemsSection]);
      }
      showToast('success', 'Archivo generado.');
    } catch (err) {
      console.error('Export error:', err);
      showToast('error', 'No se pudo generar el archivo.');
    } finally {
      setExporting(false);
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

  return (
    <div className="flex flex-col gap-7 animate-in fade-in duration-300">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-5">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.025em] leading-[1.15]">
            Historial de transacciones
          </h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1.5 max-w-xl">
            Revisa el estado de cada recibo que enviaste. Puedes editar y
            reenviar los que fueron rechazados.
          </p>
        </div>
        <div className="flex items-center gap-2 self-start md:self-auto">
          <Button
            variant="secondary"
            size="md"
            disabled={receipts.length === 0 || exporting}
            onClick={() => handleExport('xlsx')}
            title="Exportar historial a Excel"
          >
            <FileSpreadsheet size={14} strokeWidth={1.75} />
            Excel
          </Button>
          <Button
            variant="secondary"
            size="md"
            disabled={receipts.length === 0 || exporting}
            onClick={() => handleExport('pdf')}
            title="Exportar historial a PDF"
          >
            <FileDown size={14} strokeWidth={1.75} />
            PDF
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => router.push('/dashboard/compras')}
          >
            <Plus size={15} strokeWidth={1.75} />
            Nueva compra
          </Button>
        </div>
      </header>

      {receipts.length === 0 ? (
        <Card padding="lg" className="text-center py-10">
          <div className="mx-auto w-12 h-12 rounded-full bg-[var(--color-surface-alt)] flex items-center justify-center text-[var(--color-text-subtle)] mb-3">
            <Receipt size={20} strokeWidth={1.5} />
          </div>
          <h2 className="text-[15px] font-semibold tracking-tight">
            Aún no has enviado recibos
          </h2>
          <p className="text-[13px] text-[var(--color-text-muted)] mt-1">
            Cuando hagas tu primera compra aparecerá aquí.
          </p>
          <Button
            variant="primary"
            size="md"
            className="mt-4"
            onClick={() => router.push('/dashboard/compras')}
          >
            Comprar acciones
          </Button>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {receipts.map((r) => {
            const isExpanded = expanded.has(r.id);
            const isEditing = editing === r.id;
            const tone = statusTone(r.status);

            return (
              <Card key={r.id} padding="none" className="overflow-hidden">
                {/* Fila compacta */}
                <button
                  type="button"
                  onClick={() => toggleExpanded(r.id)}
                  className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-[var(--color-surface-alt)] cursor-pointer transition-colors"
                >
                  <div className="w-10 h-10 rounded-[10px] bg-[var(--color-surface-alt)] flex items-center justify-center text-[var(--color-text-muted)] shrink-0">
                    <Receipt size={18} strokeWidth={1.75} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[14px] font-semibold tabular">
                        {r.receipt_number ?? '—'}
                      </span>
                      <Badge tone={tone} dot>
                        {receiptStatusLabel(r.status)}
                      </Badge>
                    </div>
                    <div className="text-[12px] text-[var(--color-text-subtle)] mt-0.5">
                      Enviado: {formatDateTime(r.submitted_at)}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[15px] font-semibold tabular">
                      {cop(r.total_amount)}
                    </div>
                    <div className="text-[11px] text-[var(--color-text-subtle)]">
                      {r.items.length} {r.items.length === 1 ? 'línea' : 'líneas'}
                    </div>
                  </div>
                  <div className="shrink-0 text-[var(--color-text-subtle)]">
                    {isExpanded ? (
                      <ChevronUp size={18} strokeWidth={1.75} />
                    ) : (
                      <ChevronDown size={18} strokeWidth={1.75} />
                    )}
                  </div>
                </button>

                {/* Detalles */}
                {isExpanded && (
                  <div className="px-5 pb-5 border-t border-[var(--color-border)] bg-[var(--color-surface-alt)]/40">
                    {/* Banner rechazo */}
                    {r.status === 'rejected' && (
                      <div className="mt-4 flex items-start gap-3 p-3.5 rounded-[10px] bg-[var(--color-danger-soft)]/60 border border-[var(--color-danger)]/40">
                        <AlertTriangle
                          size={16}
                          strokeWidth={1.75}
                          className="text-[var(--color-danger)] mt-0.5 shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="text-[13px] font-semibold text-[var(--color-danger)]">
                            Recibo rechazado
                          </div>
                          <div className="text-[12px] text-[var(--color-text)] mt-1">
                            {rejectionReasonLabel(r.rejection_reason)}
                          </div>
                          {r.rejection_note && (
                            <div className="text-[12px] text-[var(--color-text-muted)] mt-1 italic">
                              Nota: {r.rejection_note}
                            </div>
                          )}
                          {r.reviewed_at && (
                            <div className="text-[11px] text-[var(--color-text-subtle)] mt-1">
                              Revisado: {formatDateTime(r.reviewed_at)}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Banner aprobado */}
                    {r.status === 'approved' && r.reviewed_at && (
                      <div className="mt-4 flex items-start gap-3 p-3.5 rounded-[10px] bg-[var(--color-success-soft)]/60 border border-[var(--color-success)]/40">
                        <CheckCircle2
                          size={16}
                          strokeWidth={1.75}
                          className="text-[var(--color-success)] mt-0.5 shrink-0"
                        />
                        <div>
                          <div className="text-[13px] font-semibold text-[var(--color-success)]">
                            Aprobado
                          </div>
                          <div className="text-[11px] text-[var(--color-text-subtle)] mt-0.5">
                            {formatDateTime(r.reviewed_at)}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Items */}
                    <div className="mt-4">
                      <div className="text-[10px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase mb-2">
                        Detalle
                      </div>
                      <div className="divide-y divide-[var(--color-border)] rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)]">
                        {r.items.map((it) => (
                          <div
                            key={it.id}
                            className="flex items-center gap-3 px-3.5 py-2.5 text-[13px]"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold text-[var(--color-text)]">
                                {conceptLabel(it.concept)}
                                {it.auto_generated && (
                                  <span className="ml-2 text-[10px] font-semibold text-[var(--color-warn)] tracking-wider uppercase">
                                    Auto
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-[var(--color-text-subtle)]">
                                {monthLabel(it.target_month, true)}
                                {it.share_count ? ` · ${it.share_count} acciones` : ''}
                                {it.unit_value
                                  ? ` · ${cop(Number(it.unit_value))} c/u`
                                  : ''}
                              </div>
                            </div>
                            <div className="text-right font-semibold tabular">
                              {cop(Number(it.amount))}
                            </div>
                          </div>
                        ))}
                        <div className="flex items-center gap-3 px-3.5 py-2.5 text-[13px] bg-[var(--color-surface-alt)]">
                          <span className="flex-1 font-semibold text-[var(--color-text)]">
                            Total
                          </span>
                          <span className="font-semibold tabular">
                            {cop(r.total_amount)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Acciones */}
                    <div className="mt-4 flex items-center gap-2 flex-wrap">
                      {r.payment_proof_path && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => openProof(r.payment_proof_path)}
                        >
                          <Download size={14} strokeWidth={1.75} />
                          Ver comprobante
                        </Button>
                      )}
                      {r.status === 'rejected' && !isEditing && (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => startEdit(r)}
                        >
                          <RefreshCw size={14} strokeWidth={1.75} />
                          Editar y reenviar
                        </Button>
                      )}
                    </div>

                    {/* Panel de edición (solo rechazados) */}
                    {isEditing && (
                      <div className="mt-5 p-4 rounded-[12px] border border-[var(--color-brand)]/40 bg-[var(--color-surface)]">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-[14px] font-semibold tracking-tight">
                            Editar recibo
                          </h3>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="w-7 h-7 rounded-[7px] flex items-center justify-center text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] cursor-pointer"
                            aria-label="Cancelar edición"
                          >
                            <X size={15} strokeWidth={1.75} />
                          </button>
                        </div>

                        {/* Líneas */}
                        <div className="flex flex-col gap-2">
                          {editLines.map((l) => {
                            const total = editMonthTotals.get(l.target_month) ?? 0;
                            const overMax = total > rules.max_shares_per_month;
                            const sub = l.share_count * (shareValue ?? 0);
                            return (
                              <div
                                key={l.uid}
                                className={`grid grid-cols-1 md:grid-cols-[1fr_120px_120px_32px] items-end gap-2 p-2.5 rounded-[9px] border ${
                                  overMax
                                    ? 'border-[var(--color-danger)]'
                                    : 'border-[var(--color-border)]'
                                } bg-[var(--color-surface-alt)]`}
                              >
                                <div className="flex flex-col gap-1">
                                  <label className="text-[10px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase">
                                    Mes
                                  </label>
                                  <select
                                    value={l.target_month}
                                    onChange={(e) =>
                                      updateEditLine(l.uid, {
                                        target_month: e.target.value,
                                      })
                                    }
                                    className="h-9 rounded-[8px] bg-[var(--color-surface)] border border-[var(--color-border)] px-2 text-[13px] font-medium focus:outline-none focus:border-[var(--color-brand)]"
                                  >
                                    {monthOptions.map((m) => (
                                      <option key={m.value} value={m.value}>
                                        {m.label}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div className="flex flex-col gap-1">
                                  <label className="text-[10px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase">
                                    Acciones
                                  </label>
                                  <input
                                    type="number"
                                    min={rules.min_shares_per_month}
                                    max={rules.max_shares_per_month}
                                    value={l.share_count}
                                    onChange={(e) => {
                                      const v = Number(e.target.value);
                                      if (Number.isFinite(v)) {
                                        updateEditLine(l.uid, {
                                          share_count: Math.max(
                                            1,
                                            Math.min(
                                              rules.max_shares_per_month,
                                              Math.floor(v),
                                            ),
                                          ),
                                        });
                                      }
                                    }}
                                    className="h-9 rounded-[8px] bg-[var(--color-surface)] border border-[var(--color-border)] px-2.5 text-[13px] font-semibold text-center tabular focus:outline-none focus:border-[var(--color-brand)]"
                                  />
                                </div>
                                <div className="flex flex-col gap-1">
                                  <label className="text-[10px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase">
                                    Subtotal
                                  </label>
                                  <div className="h-9 flex items-center text-[13px] font-semibold tabular">
                                    {cop(sub)}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => removeEditLine(l.uid)}
                                  disabled={editLines.length === 1}
                                  aria-label="Quitar línea"
                                  className="w-8 h-9 rounded-[8px] flex items-center justify-center text-[var(--color-text-subtle)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                                >
                                  <Trash2 size={14} strokeWidth={1.75} />
                                </button>
                              </div>
                            );
                          })}
                        </div>

                        <div className="mt-2">
                          <Button variant="ghost" size="sm" onClick={addEditLine}>
                            <Plus size={14} strokeWidth={1.75} />
                            Agregar mes
                          </Button>
                        </div>

                        {/* Preview multa */}
                        {editFinePreview.length > 0 && (
                          <div className="mt-3 p-3 rounded-[9px] bg-[var(--color-warn-soft)]/40 border border-[var(--color-warn)]/40">
                            <div className="text-[11px] font-semibold text-[var(--color-warn)] tracking-wider uppercase mb-1.5">
                              Multas que se recalculan
                            </div>
                            <ul className="text-[12px] flex flex-col gap-1">
                              {editFinePreview.map((f) => (
                                <li
                                  key={f.month}
                                  className="flex items-center justify-between"
                                >
                                  <span>{monthLabel(f.month, true)}</span>
                                  <span className="font-semibold tabular text-[var(--color-warn)]">
                                    + {cop(f.amount)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Nuevo comprobante */}
                        <div className="mt-4">
                          <div className="text-[11px] font-semibold text-[var(--color-text-subtle)] tracking-wider uppercase mb-1.5">
                            Nuevo comprobante
                          </div>
                          {!editFile ? (
                            <label
                              htmlFor={`edit-file-${r.id}`}
                              className={`flex items-center gap-3 h-14 px-3.5 rounded-[10px] border border-dashed cursor-pointer ${
                                editFileError
                                  ? 'border-[var(--color-danger)] bg-[var(--color-danger-soft)]/30'
                                  : 'border-[var(--color-border)] bg-[var(--color-surface-alt)] hover:bg-[var(--color-surface)]'
                              }`}
                            >
                              <Upload
                                size={16}
                                strokeWidth={1.75}
                                className="text-[var(--color-text-subtle)]"
                              />
                              <span className="text-[13px] font-medium">
                                Seleccionar archivo (JPG, PNG o PDF, máx 5 MB)
                              </span>
                              <input
                                id={`edit-file-${r.id}`}
                                ref={editFileInputRef}
                                type="file"
                                accept="image/jpeg,image/png,application/pdf"
                                className="hidden"
                                onChange={(e) =>
                                  handleEditFileChange(e.target.files?.[0] ?? null)
                                }
                              />
                            </label>
                          ) : (
                            <div className="flex items-center gap-3 p-3 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-alt)]">
                              <FileText
                                size={16}
                                strokeWidth={1.75}
                                className="text-[var(--color-text-muted)]"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="text-[13px] font-semibold truncate">
                                  {editFile.name}
                                </div>
                                <div className="text-[11px] text-[var(--color-text-subtle)]">
                                  {(editFile.size / 1024).toFixed(0)} KB
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleEditFileChange(null)}
                                aria-label="Quitar archivo"
                                className="w-7 h-7 rounded-[7px] flex items-center justify-center text-[var(--color-text-subtle)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)] cursor-pointer"
                              >
                                <X size={14} strokeWidth={1.75} />
                              </button>
                            </div>
                          )}
                          {editFileError && (
                            <div className="mt-2 text-[11px] font-medium text-[var(--color-danger)]">
                              {editFileError}
                            </div>
                          )}
                        </div>

                        {/* Totales + acciones */}
                        <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
                          <div className="text-[12px] text-[var(--color-text-muted)]">
                            Total a pagar:{' '}
                            <span className="text-[15px] font-semibold text-[var(--color-text)] tabular">
                              {cop(editSharesSubtotal + editFinesSubtotal)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button variant="ghost" size="sm" onClick={cancelEdit}>
                              Cancelar
                            </Button>
                            <Button
                              variant="primary"
                              size="sm"
                              disabled={
                                submittingId === r.id ||
                                !!editValidationError ||
                                !editFile
                              }
                              onClick={submitResubmit}
                            >
                              {submittingId === r.id ? (
                                'Enviando…'
                              ) : (
                                <>
                                  <CheckCircle2 size={14} strokeWidth={2} />
                                  Reenviar
                                </>
                              )}
                            </Button>
                          </div>
                        </div>

                        {editValidationError && (
                          <div className="mt-2 text-[11px] font-medium text-[var(--color-danger)]">
                            {editValidationError}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
