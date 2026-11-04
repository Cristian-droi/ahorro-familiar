import { getAjustesDePrestamo } from '@/lib/loan-settings';
import { type SupabaseClient } from '@supabase/supabase-js';
import { type Database } from '@/types/database';
import { getOpenPeriodShareValue } from '@/lib/data/share-value';
import { getLoanInterestItems } from '@/lib/data/loans';
import { calcAccruedInterest, type LoanInterestItem } from '@/lib/loans';
import { DEFAULT_PURCHASE_RULES, type PurchaseRules, toReglasDeMulta } from '@/lib/fines';
import { estadoDeObligaciones, type PrestamoActivo } from '@/modules/pagos/domain/obligaciones';
import { hoyBogota, type FechaISO } from '@/shared/domain/fechas';

export interface UserObligationsStatus {
  isUpToDate: boolean;
  reasons: string[];
  accionesShortage: boolean;
  // Open-period share value; null while it is not chosen (RN-2.3).
  shareValue: number | null;
  finesPending: boolean;
  interestOwed: boolean;
  sharesOwedCount: number;
  sharesOwedAmount: number;
  finesOwedAmount: number;
  interestOwedAmount: number;
  totalOwedAmount: number;
  overdueMonthsDetails: Array<{
    month: string;
    monthName: string;
    sharesOwed: number;
    shareValue: number;
    fineOwed: number;
  }>;
  activeLoansDetails: Array<{
    loanId: string;
    disbursementNumber: string | null;
    outstandingBalance: number;
    interestOwed: number;
  }>;
}

// Carga las reglas de compra de forma segura tanto para cliente como servidor
async function getPurchaseRules(supabase: SupabaseClient<Database>): Promise<PurchaseRules> {
  try {
    const { data } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'purchase_rules')
      .maybeSingle();

    if (!data?.value) return DEFAULT_PURCHASE_RULES;
    const v = data.value as Partial<PurchaseRules>;
    return {
      min_shares_per_month:
        v.min_shares_per_month ?? DEFAULT_PURCHASE_RULES.min_shares_per_month,
      max_shares_per_month:
        v.max_shares_per_month ?? DEFAULT_PURCHASE_RULES.max_shares_per_month,
      fine_per_day: v.fine_per_day ?? DEFAULT_PURCHASE_RULES.fine_per_day,
      fine_max_per_month:
        v.fine_max_per_month ?? DEFAULT_PURCHASE_RULES.fine_max_per_month,
      grace_period_days:
        v.grace_period_days ?? DEFAULT_PURCHASE_RULES.grace_period_days,
    };
  } catch {
    return DEFAULT_PURCHASE_RULES;
  }
}

/**
 * Valida si un accionista está al día con sus obligaciones.
 * Solo hace la I/O; el cálculo vive en `estadoDeObligaciones` (pagos/domain).
 */
export async function checkUserObligations(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<UserObligationsStatus> {
  // 1. Reglas de compra, valor de acción del periodo y fecha de hoy en Bogotá
  const rules = await getPurchaseRules(supabase);
  const hoy = hoyBogota(new Date());
  const currentYear = Number(hoy.slice(0, 4));
  const shareValue = await getOpenPeriodShareValue(supabase, userId);

  // 2. Ítems de recibos aprobados (acciones y multas) del año en curso
  const startOfYear = `${currentYear}-01-01`;
  const endOfYear = `${currentYear + 1}-01-01`;
  const { data: receiptItems, error: itemsError } = await supabase
    .from('receipt_items')
    .select('concept, target_month, share_count, receipts!inner(status, user_id)')
    .eq('receipts.user_id', userId)
    .eq('receipts.status', 'approved')
    .gte('target_month', startOfYear)
    .lt('target_month', endOfYear);

  if (itemsError) {
    console.error('Error al consultar recibos para verificar obligaciones:', itemsError);
    throw itemsError;
  }

  const accionesCompradas: Array<{ mes: FechaISO; acciones: number }> = [];
  const mesesConMultaPagada: FechaISO[] = [];
  for (const item of receiptItems || []) {
    if (item.concept === 'acciones') {
      accionesCompradas.push({ mes: item.target_month as FechaISO, acciones: item.share_count ?? 0 });
    } else if (item.concept === 'multa_acciones') {
      mesesConMultaPagada.push(item.target_month as FechaISO);
    }
  }

  // 3. Préstamos activos y su interés adeudado, calculado en el dominio
  //    (interesesAdeudados, sección 11 n.º 13) con una sola consulta de pagos.
  const { data: activeLoans, error: loansError } = await supabase
    .from('loans')
    .select('id, loan_number, disbursement_number, outstanding_balance, requested_amount, interest_rate, disbursed_at')
    .eq('user_id', userId)
    .eq('status', 'active')
    .not('disbursed_at', 'is', null);

  if (loansError) {
    console.error('Error al consultar préstamos para verificar obligaciones:', loansError);
    throw loansError;
  }

  const loans = activeLoans || [];
  let itemsByLoan: Map<string, LoanInterestItem[]>;
  try {
    itemsByLoan = await getLoanInterestItems(supabase, loans.map((l) => l.id));
  } catch (interestItemsError) {
    console.error('Error al consultar pagos de préstamos para verificar obligaciones:', interestItemsError);
    throw interestItemsError;
  }

  const ajustes = await getAjustesDePrestamo(supabase);
  const prestamos: PrestamoActivo[] = [];
  for (const loan of loans) {
    const interes = calcAccruedInterest({
      requestedAmount: loan.requested_amount,
      rate: loan.interest_rate,
      disbursedAt: loan.disbursed_at as string,
      items: itemsByLoan.get(loan.id) ?? [],
      today: hoy,
      ajustes,
    });
    if (!interes.ok) {
      console.error(`Error al calcular el interés adeudado del préstamo ${loan.id}:`, interes.error);
      throw new Error(interes.error.mensaje);
    }

    prestamos.push({
      id: loan.id,
      numero: loan.loan_number,
      numeroDeDesembolso: loan.disbursement_number,
      saldo: Number(loan.outstanding_balance || 0),
      interesAdeudado: interes.value,
    });
  }

  // 4. Cálculo en el dominio (RN-2.3, RN-3.1, RN-3.4, RN-4.22)
  const estado = estadoDeObligaciones({
    hoy,
    reglas: {
      compra: {
        minAccionesPorMes: rules.min_shares_per_month,
        maxAccionesPorMes: rules.max_shares_per_month,
      },
      multa: toReglasDeMulta(rules),
    },
    valorDeAccion: shareValue,
    accionesCompradas,
    mesesConMultaPagada,
    prestamos,
  });

  return {
    isUpToDate: estado.alDia,
    reasons: estado.razones,
    accionesShortage: estado.faltanAcciones,
    shareValue: estado.valorDeAccion,
    finesPending: estado.multasPendientes,
    interestOwed: estado.debeIntereses,
    sharesOwedCount: estado.accionesAdeudadas,
    sharesOwedAmount: estado.montoAcciones,
    finesOwedAmount: estado.montoMultas,
    interestOwedAmount: estado.montoIntereses,
    totalOwedAmount: estado.total,
    overdueMonthsDetails: estado.mesesEnMora.map((m) => ({
      month: m.mes,
      monthName: m.nombreDelMes,
      sharesOwed: m.accionesAdeudadas,
      shareValue: m.valorDeAccion,
      fineOwed: m.multa,
    })),
    // `loanNumber` is not in the interface but has always been returned.
    activeLoansDetails: estado.prestamos.map((p) => ({
      loanId: p.id,
      loanNumber: p.numero,
      disbursementNumber: p.numeroDeDesembolso,
      outstandingBalance: p.saldo,
      interestOwed: p.interesAdeudado,
    })),
  };
}
