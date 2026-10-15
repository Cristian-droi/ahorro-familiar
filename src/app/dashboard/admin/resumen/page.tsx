'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { getProfileRole } from '@/lib/data/profiles';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { showToast } from '@/components/ui/Toast';
import { cop } from '@/lib/format';
import { exportToExcel, exportToPdf, type ExportColumn, type ExportRow, type ExportSection } from '@/lib/exports';
import {
  FileSpreadsheet,
  FileText,
  TrendingUp,
  Calendar,
  Loader2,
  AlertCircle
} from 'lucide-react';

interface ShareholderRow {
  id: string;
  name: string;
  document: string;
  // 1. N° acciones
  sharesCount: number;
  // 2. Valor acciones
  sharesValue: number;
  // 3. Capitalizaciones
  capitalizations: number;
  // 4. Total acciones + capitalizaciones
  totalSharesCapitalizations: number;
  // 5. Multas
  fines: number;
  // 6. Prestamos
  loansDisbursed: number;
  // 7. Pagos a capital
  capitalPayments: number;
  // 8. Pago a intereses
  interestPayments: number;
  // 9. Deuda capital
  capitalDebt: number;
  // 10. Deuda intereses
  interestDebt: number;
  // 11. Distribución de utilidades
  utilitiesDistribution: number;
  // 12. Total a pagar
  totalToPay: number;
  // 13. Total deuda
  totalDebt: number;
  // 14. Gastos
  expenses: number;
  // 15. Acciones [Siguiente Año]
  nextYearShares: number;
  // 16. Capitalización [Siguiente Año]
  nextYearCapitalization: number;
  // 17. Deuda a pagar [Siguiente Año]
  nextYearDebtToPay: number;
  // 18. Total a descontar
  totalToDeduct: number;
  // 19. Total devolución
  totalRefund: number;
}

export default function AdminResumenPage() {
  const router = useRouter();
  const [role, setRole] = useState<'admin' | 'accionista' | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [shareholders, setShareholders] = useState<ShareholderRow[]>([]);
  const [expensesPercentage, setExpensesPercentage] = useState<number>(0.10);
  const [nextYearSharesPercentage, setNextYearSharesPercentage] = useState<number>(0.30);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  // Selector de años: 3 años atrás y 2 adelante
  const years = useMemo(() => {
    const current = new Date().getFullYear();
    const list = [];
    for (let y = current - 3; y <= current + 2; y++) {
      list.push(y);
    }
    return list;
  }, []);

  const fetchData = useCallback(async (year: number) => {
    setLoading(true);
    try {
      // 1. Cargar perfiles activos
      const { data: profiles, error: profilesErr } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, identity_document, selected_share_value, next_year_capitalization')
        .eq('role', 'accionista')
        .order('first_name');

      if (profilesErr) throw profilesErr;
      if (!profiles || profiles.length === 0) {
        setShareholders([]);
        setLoading(false);
        return;
      }

      // 2. Cargar configuraciones del sistema
      const { data: settingsList, error: settingsErr } = await supabase
        .from('system_settings')
        .select('key, value')
        .in('key', ['resumen_expenses_percentage', 'resumen_next_year_shares_percentage']);

      if (settingsErr) throw settingsErr;

      const expPct = Number(settingsList?.find(s => s.key === 'resumen_expenses_percentage')?.value ?? 0.10);
      const nextSharesPct = Number(settingsList?.find(s => s.key === 'resumen_next_year_shares_percentage')?.value ?? 0.30);
      setExpensesPercentage(expPct);
      setNextYearSharesPercentage(nextSharesPct);

      // 3. Cargar recibos y detalles aprobados del año seleccionado
      const start = `${year}-01-01`;
      const end = `${year + 1}-01-01`;
      const { data: receiptItems, error: itemsErr } = await supabase
        .from('receipt_items')
        .select('concept, share_count, amount, target_month, receipts!inner(user_id, status)')
        .eq('receipts.status', 'approved')
        .gte('target_month', start)
        .lt('target_month', end);

      if (itemsErr) throw itemsErr;

      // 4. Cargar todos los préstamos para ver desembolsos del año y deudas de capital activas
      const { data: allLoans, error: loansErr } = await supabase
        .from('loans')
        .select('id, user_id, requested_amount, outstanding_balance, status, disbursed_at')
        .in('status', ['active', 'paid']);

      if (loansErr) throw loansErr;

      // 5. Cargar todos los plan items de los préstamos activos para calcular deuda de intereses total
      const activeLoanIds = allLoans?.filter(l => l.status === 'active').map(l => l.id) || [];
      
      let planItems: { loan_id: string; estimated_interest: number }[] = [];
      let paidInterests: { loan_id: string; amount: number }[] = [];

      if (activeLoanIds.length > 0) {
        const [planRes, paidIntRes] = await Promise.all([
          supabase
            .from('loan_payment_plan_items')
            .select('loan_id, estimated_interest')
            .in('loan_id', activeLoanIds),
          supabase
            .from('receipt_items')
            .select('loan_id, amount, receipts!inner(status)')
            .eq('receipts.status', 'approved')
            .eq('concept', 'pago_intereses')
            .in('loan_id', activeLoanIds)
        ]);

        if (planRes.error) throw planRes.error;
        if (paidIntRes.error) throw paidIntRes.error;

        planItems = (planRes.data || []).map(p => ({
          loan_id: p.loan_id,
          estimated_interest: Number(p.estimated_interest || 0)
        }));

        paidInterests = (paidIntRes.data || []).map(pi => ({
          loan_id: pi.loan_id || '',
          amount: Number(pi.amount || 0)
        }));
      }

      // 6. Cargar utilidades distribuidas en el año para TODOS los usuarios en una sola consulta
      const { data: allUtilities } = await supabase
        .rpc('get_all_users_utilities_by_year', { p_year: year });

      const utilitiesMap = new Map<string, number>();
      for (const u of (allUtilities || [])) {
        const uid = (u as { user_id: string; distribution: number }).user_id;
        const dist = Number((u as { user_id: string; distribution: number }).distribution || 0);
        utilitiesMap.set(uid, (utilitiesMap.get(uid) || 0) + dist);
      }

      // 7. Procesar y tabular los datos de cada accionista
      const rows: ShareholderRow[] = profiles.map(profile => {
        const userId = profile.id;
        const name = `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || 'Accionista sin Nombre';
        const document = profile.identity_document ?? '—';

        // Filtrar receipt items del usuario
        const userItems = receiptItems?.filter(it => it.receipts.user_id === userId) || [];

        // 1. N° acciones
        const sharesCount = userItems
          .filter(it => it.concept === 'acciones' || it.concept === 'acciones_prestamo')
          .reduce((sum, it) => sum + Number(it.share_count || 0), 0);

        // 2. Valor acciones
        const sharesValue = userItems
          .filter(it => it.concept === 'acciones' || it.concept === 'acciones_prestamo')
          .reduce((sum, it) => sum + Number(it.amount || 0), 0);

        // 3. Capitalizaciones
        const capitalizations = userItems
          .filter(it => it.concept === 'capitalizacion')
          .reduce((sum, it) => sum + Number(it.amount || 0), 0);

        // 4. Total acciones + capitalizaciones
        const totalSharesCapitalizations = sharesValue + capitalizations;

        // 5. Multas
        const fines = userItems
          .filter(it => it.concept === 'multa_acciones')
          .reduce((sum, it) => sum + Number(it.amount || 0), 0);

        // 6. Prestamos (desembolsados en el año seleccionado)
        const userLoans = allLoans?.filter(l => l.user_id === userId) || [];
        const loansDisbursed = userLoans
          .filter(l => {
            if (!l.disbursed_at) return false;
            const disbYear = new Date(l.disbursed_at).getFullYear();
            return disbYear === year;
          })
          .reduce((sum, l) => sum + Number(l.requested_amount || 0), 0);

        // 7. Pagos a capital (en el año seleccionado)
        const capitalPayments = userItems
          .filter(it => it.concept === 'pago_capital')
          .reduce((sum, it) => sum + Number(it.amount || 0), 0);

        // 8. Pago a intereses (en el año seleccionado)
        const interestPayments = userItems
          .filter(it => it.concept === 'pago_intereses')
          .reduce((sum, it) => sum + Number(it.amount || 0), 0);

        // 9. Deuda capital (saldo pendiente actual total)
        const capitalDebt = userLoans
          .filter(l => l.status === 'active')
          .reduce((sum, l) => sum + Number(l.outstanding_balance || 0), 0);

        // 10. Deuda intereses
        // Total estimado en plan de préstamos activos - total intereses pagados en plan de préstamos activos
        const activeUserLoans = userLoans.filter(l => l.status === 'active');
        let interestDebt = 0;
        for (const l of activeUserLoans) {
          const estimated = planItems
            .filter(pi => pi.loan_id === l.id)
            .reduce((sum, pi) => sum + pi.estimated_interest, 0);
          const paid = paidInterests
            .filter(pi => pi.loan_id === l.id)
            .reduce((sum, pi) => sum + pi.amount, 0);
          const owed = estimated - paid;
          interestDebt += owed > 0 ? owed : 0;
        }

        // 11. Distribución de utilidades (acumulada anual del RPC consolidado)
        const utilitiesDistribution = utilitiesMap.get(userId) || 0;

        // 12. Total a pagar (Total acciones + cap + utilidades)
        const totalToPay = totalSharesCapitalizations + utilitiesDistribution;

        // 13. Total deuda (Deuda capital + Deuda intereses)
        const totalDebt = capitalDebt + interestDebt;

        // 14. Gastos (Distribución de utilidades * % gastos)
        const expenses = Math.round(utilitiesDistribution * expPct);

        // 15. Acciones [Siguiente Año] (Valor acciones * % acciones sig)
        const nextYearShares = Math.round(sharesValue * nextSharesPct);

        // 16. Capitalización [Siguiente Año] (Monto definido por el accionista en su perfil)
        const nextYearCapitalization = Number(profile.next_year_capitalization || 0);

        // 17. Deuda a pagar [Siguiente Año] (Placeholder para futuro desarrollo)
        const nextYearDebtToPay = 0;

        // 18. Total a descontar
        const totalToDeduct = totalDebt + expenses + nextYearShares + nextYearCapitalization + nextYearDebtToPay;

        // 19. Total devolución (Total a pagar - Total a descontar)
        const totalRefund = totalToPay - totalToDeduct;

        return {
          id: userId,
          name,
          document,
          sharesCount,
          sharesValue,
          capitalizations,
          totalSharesCapitalizations,
          fines,
          loansDisbursed,
          capitalPayments,
          interestPayments,
          capitalDebt,
          interestDebt,
          utilitiesDistribution,
          totalToPay,
          totalDebt,
          expenses,
          nextYearShares,
          nextYearCapitalization,
          nextYearDebtToPay,
          totalToDeduct,
          totalRefund,
        };
      });

      setShareholders(rows);
    } catch (err: unknown) {
      console.error('Error fetching resumen data:', err);
      showToast('error', 'Error al cargar los datos del resumen');
    } finally {
      setLoading(false);
    }
  }, []);

  // Efecto de seguridad y primera carga
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
      await fetchData(selectedYear);
    })();
    return () => {
      cancelled = true;
    };
  }, [router, selectedYear, fetchData]);

  // Totales de columnas
  const totals = useMemo(() => {
    const sum = {
      sharesCount: 0,
      sharesValue: 0,
      capitalizations: 0,
      totalSharesCapitalizations: 0,
      fines: 0,
      loansDisbursed: 0,
      capitalPayments: 0,
      interestPayments: 0,
      capitalDebt: 0,
      interestDebt: 0,
      utilitiesDistribution: 0,
      totalToPay: 0,
      totalDebt: 0,
      expenses: 0,
      nextYearShares: 0,
      nextYearCapitalization: 0,
      nextYearDebtToPay: 0,
      totalToDeduct: 0,
      totalRefund: 0,
    };

    for (const s of shareholders) {
      sum.sharesCount += s.sharesCount;
      sum.sharesValue += s.sharesValue;
      sum.capitalizations += s.capitalizations;
      sum.totalSharesCapitalizations += s.totalSharesCapitalizations;
      sum.fines += s.fines;
      sum.loansDisbursed += s.loansDisbursed;
      sum.capitalPayments += s.capitalPayments;
      sum.interestPayments += s.interestPayments;
      sum.capitalDebt += s.capitalDebt;
      sum.interestDebt += s.interestDebt;
      sum.utilitiesDistribution += s.utilitiesDistribution;
      sum.totalToPay += s.totalToPay;
      sum.totalDebt += s.totalDebt;
      sum.expenses += s.expenses;
      sum.nextYearShares += s.nextYearShares;
      sum.nextYearCapitalization += s.nextYearCapitalization;
      sum.nextYearDebtToPay += s.nextYearDebtToPay;
      sum.totalToDeduct += s.totalToDeduct;
      sum.totalRefund += s.totalRefund;
    }

    return sum;
  }, [shareholders]);

  // Exportadores
  const handleExportExcel = async () => {
    setIsExportingExcel(true);
    try {
      const nextYear = selectedYear + 1;
      const columns: ExportColumn[] = [
        { header: 'Accionista', key: 'name', width: 25 },
        { header: 'Documento', key: 'document', width: 15 },
        { header: 'N° acciones', key: 'sharesCount', align: 'right' },
        { header: 'Valor acciones', key: 'sharesValue', align: 'right' },
        { header: 'Capitalizaciones', key: 'capitalizations', align: 'right' },
        { header: 'Total acciones + cap.', key: 'totalSharesCapitalizations', align: 'right' },
        { header: 'Multas', key: 'fines', align: 'right' },
        { header: 'Préstamos', key: 'loansDisbursed', align: 'right' },
        { header: 'Abonos capital', key: 'capitalPayments', align: 'right' },
        { header: 'Abonos interés', key: 'interestPayments', align: 'right' },
        { header: 'Deuda capital', key: 'capitalDebt', align: 'right' },
        { header: 'Deuda interés', key: 'interestDebt', align: 'right' },
        { header: 'Distribución utilidades', key: 'utilitiesDistribution', align: 'right' },
        { header: 'Total a pagar', key: 'totalToPay', align: 'right' },
        { header: 'Total deuda', key: 'totalDebt', align: 'right' },
        { header: `Gastos (${(expensesPercentage * 100).toFixed(0)}%)`, key: 'expenses', align: 'right' },
        { header: `Acciones ${nextYear} (${(nextYearSharesPercentage * 100).toFixed(0)}%)`, key: 'nextYearShares', align: 'right' },
        { header: `Capitalización ${nextYear}`, key: 'nextYearCapitalization', align: 'right' },
        { header: `Deuda a pagar ${nextYear}`, key: 'nextYearDebtToPay', align: 'right' },
        { header: 'Total a descontar', key: 'totalToDeduct', align: 'right' },
        { header: 'Total devolución', key: 'totalRefund', align: 'right' },
      ];

      const rows: ExportRow[] = shareholders.map(s => ({
        name: s.name,
        document: s.document,
        sharesCount: s.sharesCount,
        sharesValue: cop(s.sharesValue),
        capitalizations: cop(s.capitalizations),
        totalSharesCapitalizations: cop(s.totalSharesCapitalizations),
        fines: cop(s.fines),
        loansDisbursed: cop(s.loansDisbursed),
        capitalPayments: cop(s.capitalPayments),
        interestPayments: cop(s.interestPayments),
        capitalDebt: cop(s.capitalDebt),
        interestDebt: cop(s.interestDebt),
        utilitiesDistribution: cop(s.utilitiesDistribution),
        totalToPay: cop(s.totalToPay),
        totalDebt: cop(s.totalDebt),
        expenses: cop(s.expenses),
        nextYearShares: cop(s.nextYearShares),
        nextYearCapitalization: cop(s.nextYearCapitalization),
        nextYearDebtToPay: cop(s.nextYearDebtToPay),
        totalToDeduct: cop(s.totalToDeduct),
        totalRefund: cop(s.totalRefund),
      }));

      const totalsValues: Record<string, string | number> = {
        sharesCount: totals.sharesCount,
        sharesValue: cop(totals.sharesValue),
        capitalizations: cop(totals.capitalizations),
        totalSharesCapitalizations: cop(totals.totalSharesCapitalizations),
        fines: cop(totals.fines),
        loansDisbursed: cop(totals.loansDisbursed),
        capitalPayments: cop(totals.capitalPayments),
        interestPayments: cop(totals.interestPayments),
        capitalDebt: cop(totals.capitalDebt),
        interestDebt: cop(totals.interestDebt),
        utilitiesDistribution: cop(totals.utilitiesDistribution),
        totalToPay: cop(totals.totalToPay),
        totalDebt: cop(totals.totalDebt),
        expenses: cop(totals.expenses),
        nextYearShares: cop(totals.nextYearShares),
        nextYearCapitalization: cop(totals.nextYearCapitalization),
        nextYearDebtToPay: cop(totals.nextYearDebtToPay),
        totalToDeduct: cop(totals.totalToDeduct),
        totalRefund: cop(totals.totalRefund),
      };

      const section: ExportSection = {
        name: `Resumen ${selectedYear}`,
        title: `Resumen Anual Contable de Accionistas — Año ${selectedYear}`,
        columns,
        rows,
        totals: {
          label: 'TOTALES',
          values: totalsValues,
        },
      };

      await exportToExcel(`Resumen_Accionistas_${selectedYear}`, {
        title: 'Ahorro Familiar',
        subtitle: `Resumen anual contable de accionistas del año ${selectedYear}`,
      }, [section]);

      showToast('success', 'Archivo de Excel generado correctamente');
    } catch (err: unknown) {
      console.error(err);
      showToast('error', 'Error al exportar a Excel');
    } finally {
      setIsExportingExcel(false);
    }
  };

  const handleExportPdf = async () => {
    setIsExportingPdf(true);
    try {
      const nextYear = selectedYear + 1;
      // En PDF Landscape usaremos menos espacio y etiquetas más cortas para que quepa bien
      const columns: ExportColumn[] = [
        { header: 'Accionista', key: 'name', width: 14 },
        { header: 'N° Acc', key: 'sharesCount', align: 'right', width: 5 },
        { header: 'Val Acc', key: 'sharesValue', align: 'right', width: 8 },
        { header: 'Capit.', key: 'capitalizations', align: 'right', width: 8 },
        { header: 'Total A+C', key: 'totalSharesCapitalizations', align: 'right', width: 8 },
        { header: 'Multas', key: 'fines', align: 'right', width: 7 },
        { header: 'Prést.', key: 'loansDisbursed', align: 'right', width: 8 },
        { header: 'Abo Cap', key: 'capitalPayments', align: 'right', width: 8 },
        { header: 'Abo Int', key: 'interestPayments', align: 'right', width: 8 },
        { header: 'Deu Cap', key: 'capitalDebt', align: 'right', width: 8 },
        { header: 'Deu Int', key: 'interestDebt', align: 'right', width: 8 },
        { header: 'Utilid.', key: 'utilitiesDistribution', align: 'right', width: 8 },
        { header: 'T a Pag', key: 'totalToPay', align: 'right', width: 8 },
        { header: 'T Deu', key: 'totalDebt', align: 'right', width: 8 },
        { header: 'Gastos', key: 'expenses', align: 'right', width: 8 },
        { header: `Acc ${nextYear}`, key: 'nextYearShares', align: 'right', width: 8 },
        { header: `Cap ${nextYear}`, key: 'nextYearCapitalization', align: 'right', width: 8 },
        { header: 'T Desc', key: 'totalToDeduct', align: 'right', width: 8 },
        { header: 'Devoluc.', key: 'totalRefund', align: 'right', width: 9 },
      ];

      const rows: ExportRow[] = shareholders.map(s => ({
        name: s.name,
        sharesCount: s.sharesCount,
        sharesValue: cop(s.sharesValue),
        capitalizations: cop(s.capitalizations),
        totalSharesCapitalizations: cop(s.totalSharesCapitalizations),
        fines: cop(s.fines),
        loansDisbursed: cop(s.loansDisbursed),
        capitalPayments: cop(s.capitalPayments),
        interestPayments: cop(s.interestPayments),
        capitalDebt: cop(s.capitalDebt),
        interestDebt: cop(s.interestDebt),
        utilitiesDistribution: cop(s.utilitiesDistribution),
        totalToPay: cop(s.totalToPay),
        totalDebt: cop(s.totalDebt),
        expenses: cop(s.expenses),
        nextYearShares: cop(s.nextYearShares),
        nextYearCapitalization: cop(s.nextYearCapitalization),
        totalToDeduct: cop(s.totalToDeduct),
        totalRefund: cop(s.totalRefund),
      }));

      const totalsValues: Record<string, string | number> = {
        sharesCount: totals.sharesCount,
        sharesValue: cop(totals.sharesValue),
        capitalizations: cop(totals.capitalizations),
        totalSharesCapitalizations: cop(totals.totalSharesCapitalizations),
        fines: cop(totals.fines),
        loansDisbursed: cop(totals.loansDisbursed),
        capitalPayments: cop(totals.capitalPayments),
        interestPayments: cop(totals.interestPayments),
        capitalDebt: cop(totals.capitalDebt),
        interestDebt: cop(totals.interestDebt),
        utilitiesDistribution: cop(totals.utilitiesDistribution),
        totalToPay: cop(totals.totalToPay),
        totalDebt: cop(totals.totalDebt),
        expenses: cop(totals.expenses),
        nextYearShares: cop(totals.nextYearShares),
        nextYearCapitalization: cop(totals.nextYearCapitalization),
        totalToDeduct: cop(totals.totalToDeduct),
        totalRefund: cop(totals.totalRefund),
      };

      const section: ExportSection = {
        name: `Resumen ${selectedYear}`,
        title: `Resumen Anual Contable — Año ${selectedYear}`,
        columns,
        rows,
        totals: {
          label: 'TOTALES',
          values: totalsValues,
        },
      };

      await exportToPdf(`Resumen_Accionistas_${selectedYear}`, {
        title: 'Ahorro Familiar',
        subtitle: `Resumen anual contable de accionistas del año ${selectedYear}`,
        orientation: 'landscape',
      }, [section]);

      showToast('success', 'Documento PDF generado correctamente');
    } catch (err: unknown) {
      console.error(err);
      showToast('error', 'Error al exportar a PDF');
    } finally {
      setIsExportingPdf(false);
    }
  };

  if (!role || loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-3">
        <Loader2 className="w-8 h-8 text-[var(--color-brand)] animate-spin" />
        <p className="text-sm text-[var(--color-text-subtle)]">Cargando resumen contable...</p>
      </div>
    );
  }

  const nextYear = selectedYear + 1;

  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-300">
      
      {/* Encabezado */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="text-left">
          <h1 className="text-[24px] font-semibold tracking-tight text-[var(--color-text)]">
            Resumen Anual Contable
          </h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            Visualización general de aportes, deudas, utilidades y devoluciones para cada accionista activo.
          </p>
        </div>

        {/* Controles de filtro y exportación */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Selector de Año */}
          <div className="flex items-center gap-2 px-3 h-10 rounded-[10px] bg-[var(--color-surface)] border border-[var(--color-border)] shadow-sm-soft">
            <Calendar size={15} className="text-[var(--color-text-subtle)]" />
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="bg-transparent text-sm font-semibold text-[var(--color-text)] focus:outline-none cursor-pointer"
            >
              {years.map(y => (
                <option key={y} value={y}>Año {y}</option>
              ))}
            </select>
          </div>

          {/* Botones de Exportar */}
          <Button
            size="sm"
            variant="secondary"
            onClick={handleExportExcel}
            disabled={isExportingExcel || shareholders.length === 0}
          >
            {isExportingExcel ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <FileSpreadsheet size={14} />
            )}
            Excel
          </Button>

          <Button
            size="sm"
            variant="secondary"
            onClick={handleExportPdf}
            disabled={isExportingPdf || shareholders.length === 0}
          >
            {isExportingPdf ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <FileText size={14} />
            )}
            PDF
          </Button>
        </div>
      </div>

      {/* Info Card de porcentajes aplicados */}
      <Card padding="md" className="border-[var(--color-brand)]/20 bg-[var(--color-brand-soft)]/5">
        <div className="flex items-start gap-3 text-left">
          <TrendingUp size={16} className="text-[var(--color-brand)] mt-0.5 shrink-0" />
          <div className="text-xs text-[var(--color-text-subtle)] flex flex-wrap gap-x-6 gap-y-1">
            <span>
              <strong>Porcentaje de Gastos:</strong> {(expensesPercentage * 100).toFixed(0)}% de la distribución.
            </span>
            <span>
              <strong>Porcentaje Acciones {nextYear}:</strong> {(nextYearSharesPercentage * 100).toFixed(0)}% del valor de las acciones actuales.
            </span>
            <span className="text-[var(--color-text-muted)]">
              Modificá estos porcentajes desde la pestaña de <em>Ajustes</em>.
            </span>
          </div>
        </div>
      </Card>

      {/* Tabla Contable */}
      {shareholders.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center gap-2">
          <AlertCircle size={28} className="text-[var(--color-text-subtle)]" />
          <p className="text-sm font-semibold">No se encontraron accionistas activos</p>
          <p className="text-xs text-[var(--color-text-subtle)]">
            Asegúrate de que haya perfiles con el rol de accionista registrados.
          </p>
        </Card>
      ) : (
        <div className="relative border border-[var(--color-border)] rounded-[12px] bg-[var(--color-surface)] shadow-sm-soft overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px] border-collapse text-left min-w-[2100px] table-layout-fixed">
              <thead>
                <tr className="bg-[var(--color-surface-alt)]/70 text-[var(--color-text-subtle)] border-b border-[var(--color-border)] font-semibold h-11">
                  {/* Sticky left columns */}
                  <th className="sticky left-0 bg-[var(--color-surface-alt)] z-10 px-4 border-r border-[var(--color-border)] w-[200px]">
                    Accionista
                  </th>
                  <th className="px-3 w-[110px]">Documento</th>
                  
                  {/* 19 Columnas contables */}
                  <th className="px-3 text-right w-[100px]">N° acciones</th>
                  <th className="px-3 text-right w-[130px]">Valor acciones</th>
                  <th className="px-3 text-right w-[130px]">Capitalizaciones</th>
                  <th className="px-3 text-right w-[160px] bg-[var(--color-brand-soft)]/5 text-[var(--color-brand)] font-bold">
                    Total acciones + cap.
                  </th>
                  <th className="px-3 text-right w-[110px]">Multas</th>
                  <th className="px-3 text-right w-[130px]">Préstamos</th>
                  <th className="px-3 text-right w-[130px]">Abonos capital</th>
                  <th className="px-3 text-right w-[130px]">Abonos interés</th>
                  <th className="px-3 text-right w-[130px]">Deuda capital</th>
                  <th className="px-3 text-right w-[130px]">Deuda interés</th>
                  <th className="px-3 text-right w-[150px]">Distribución util.</th>
                  
                  <th className="px-3 text-right w-[150px] bg-[var(--color-success-soft)]/10 text-[var(--color-success)] font-bold">
                    Total a pagar
                  </th>
                  <th className="px-3 text-right w-[130px] font-bold">Total deuda</th>
                  <th className="px-3 text-right w-[120px]">Gastos ({(expensesPercentage * 100).toFixed(0)}%)</th>
                  
                  {/* Siguiente año headers */}
                  <th className="px-3 text-right w-[140px] text-[var(--color-brand)] bg-[var(--color-brand-soft)]/5">
                    Acciones {nextYear}
                  </th>
                  <th className="px-3 text-right w-[150px] text-[var(--color-brand)] bg-[var(--color-brand-soft)]/5">
                    Capitalización {nextYear}
                  </th>
                  <th className="px-3 text-right w-[150px] text-[var(--color-brand)] bg-[var(--color-brand-soft)]/5">
                    Deuda {nextYear}
                  </th>
                  
                  <th className="px-3 text-right w-[150px] font-bold">Total a descontar</th>
                  <th className="px-4 text-right w-[160px] bg-[var(--color-brand-soft)]/10 text-[var(--color-brand)] font-extrabold border-l border-[var(--color-border)]">
                    Total devolución
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {shareholders.map((s) => (
                  <tr
                    key={s.id}
                    className="hover:bg-[var(--color-surface-alt)]/30 transition-colors h-11"
                  >
                    {/* Sticky Name */}
                    <td className="sticky left-0 bg-[var(--color-surface)] hover:bg-[var(--color-surface-alt)] z-10 px-4 font-semibold text-[var(--color-text)] border-r border-[var(--color-border)] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] truncate">
                      {s.name}
                    </td>
                    <td className="px-3 text-[var(--color-text-subtle)] truncate">{s.document}</td>
                    
                    {/* Contable Values */}
                    <td className="px-3 text-right font-medium tabular">{s.sharesCount}</td>
                    <td className="px-3 text-right tabular">{cop(s.sharesValue)}</td>
                    <td className="px-3 text-right tabular">{cop(s.capitalizations)}</td>
                    <td className="px-3 text-right font-bold text-[var(--color-brand)] bg-[var(--color-brand-soft)]/5 tabular">
                      {cop(s.totalSharesCapitalizations)}
                    </td>
                    <td className="px-3 text-right tabular text-[var(--color-danger)]">{cop(s.fines)}</td>
                    <td className="px-3 text-right tabular">{cop(s.loansDisbursed)}</td>
                    <td className="px-3 text-right tabular text-[var(--color-success)]">{cop(s.capitalPayments)}</td>
                    <td className="px-3 text-right tabular text-[var(--color-success)]">{cop(s.interestPayments)}</td>
                    <td className="px-3 text-right tabular">{cop(s.capitalDebt)}</td>
                    <td className="px-3 text-right tabular">{cop(s.interestDebt)}</td>
                    <td className="px-3 text-right tabular">{cop(s.utilitiesDistribution)}</td>
                    
                    <td className="px-3 text-right font-bold text-[var(--color-success)] bg-[var(--color-success-soft)]/10 tabular">
                      {cop(s.totalToPay)}
                    </td>
                    <td className="px-3 text-right font-bold text-[var(--color-danger)]/80 tabular">{cop(s.totalDebt)}</td>
                    <td className="px-3 text-right tabular">{cop(s.expenses)}</td>
                    
                    {/* Siguiente año values */}
                    <td className="px-3 text-right bg-[var(--color-brand-soft)]/5 tabular">{cop(s.nextYearShares)}</td>
                    <td className="px-3 text-right bg-[var(--color-brand-soft)]/5 tabular font-semibold text-[var(--color-brand)]">{cop(s.nextYearCapitalization)}</td>
                    <td className="px-3 text-right bg-[var(--color-brand-soft)]/5 tabular">{cop(s.nextYearDebtToPay)}</td>
                    
                    <td className="px-3 text-right font-semibold tabular">{cop(s.totalToDeduct)}</td>
                    <td className="px-4 text-right font-extrabold text-[var(--color-brand)] bg-[var(--color-brand-soft)]/10 tabular border-l border-[var(--color-border)]">
                      {cop(s.totalRefund)}
                    </td>
                  </tr>
                ))}

                {/* Fila de Totales */}
                <tr className="bg-[var(--color-surface-alt)]/80 text-[var(--color-text)] font-bold border-t-2 border-double border-[var(--color-border)] h-12">
                  <td className="sticky left-0 bg-[var(--color-surface-alt)]/90 z-10 px-4 border-r border-[var(--color-border)]">
                    TOTALES
                  </td>
                  <td className="px-3">—</td>
                  <td className="px-3 text-right tabular">{totals.sharesCount}</td>
                  <td className="px-3 text-right tabular">{cop(totals.sharesValue)}</td>
                  <td className="px-3 text-right tabular">{cop(totals.capitalizations)}</td>
                  <td className="px-3 text-right text-[var(--color-brand)] bg-[var(--color-brand-soft)]/10 tabular">
                    {cop(totals.totalSharesCapitalizations)}
                  </td>
                  <td className="px-3 text-right tabular text-[var(--color-danger)]">{cop(totals.fines)}</td>
                  <td className="px-3 text-right tabular">{cop(totals.loansDisbursed)}</td>
                  <td className="px-3 text-right tabular text-[var(--color-success)]">{cop(totals.capitalPayments)}</td>
                  <td className="px-3 text-right tabular text-[var(--color-success)]">{cop(totals.interestPayments)}</td>
                  <td className="px-3 text-right tabular">{cop(totals.capitalDebt)}</td>
                  <td className="px-3 text-right tabular">{cop(totals.interestDebt)}</td>
                  <td className="px-3 text-right tabular">{cop(totals.utilitiesDistribution)}</td>
                  
                  <td className="px-3 text-right text-[var(--color-success)] bg-[var(--color-success-soft)]/15 tabular">
                    {cop(totals.totalToPay)}
                  </td>
                  <td className="px-3 text-right text-[var(--color-danger)]/90 tabular">{cop(totals.totalDebt)}</td>
                  <td className="px-3 text-right tabular">{cop(totals.expenses)}</td>
                  
                  {/* Siguiente año totales */}
                  <td className="px-3 text-right bg-[var(--color-brand-soft)]/10 tabular">{cop(totals.nextYearShares)}</td>
                  <td className="px-3 text-right bg-[var(--color-brand-soft)]/10 tabular text-[var(--color-brand)]">{cop(totals.nextYearCapitalization)}</td>
                  <td className="px-3 text-right bg-[var(--color-brand-soft)]/10 tabular">{cop(totals.nextYearDebtToPay)}</td>
                  
                  <td className="px-3 text-right tabular">{cop(totals.totalToDeduct)}</td>
                  <td className="px-4 text-right text-[var(--color-brand)] bg-[var(--color-brand-soft)]/15 tabular border-l border-[var(--color-border)]">
                    {cop(totals.totalRefund)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
