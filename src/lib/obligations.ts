import { type SupabaseClient } from '@supabase/supabase-js';
import { type Database } from '@/types/database';
import { getBogotaToday, getBogotaCurrentMonth, DEFAULT_PURCHASE_RULES, type PurchaseRules, computeFineForMonth } from '@/lib/fines';

export interface UserObligationsStatus {
  isUpToDate: boolean;
  reasons: string[];
  accionesShortage: boolean;
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
 */
export async function checkUserObligations(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<UserObligationsStatus> {
  const reasons: string[] = [];
  let accionesShortage = false;
  let finesPending = false;
  let interestOwed = false;

  // 1. Cargar reglas de compra, perfil del socio y fecha actual en Bogotá
  const rules = await getPurchaseRules(supabase);
  const today = getBogotaToday();
  const currentMonthStr = getBogotaCurrentMonth(); // YYYY-MM-01
  const currentYear = today.getUTCFullYear();

  const { data: profile } = await supabase
    .from('profiles')
    .select('selected_share_value')
    .eq('id', userId)
    .maybeSingle();
  const shareValue = profile?.selected_share_value ?? 50000;

  // 2. Determinar meses a validar (desde Enero hasta el mes actual del año en Bogotá)
  const currMonthNum = Number(currentMonthStr.split('-')[1]);
  const monthsToValidate: string[] = [];
  for (let m = 1; m <= currMonthNum; m++) {
    monthsToValidate.push(`${currentYear}-${String(m).padStart(2, '0')}-01`);
  }

  // Si hoy no ha pasado el periodo de gracia del mes actual, no exigimos el mes actual todavía.
  const graceEnd = new Date(Date.UTC(currentYear, currMonthNum - 1, rules.grace_period_days));
  if (today.getTime() <= graceEnd.getTime() && monthsToValidate.length > 0) {
    // Aún estamos dentro del periodo de gracia del mes actual
    monthsToValidate.pop();
  }

  // 3. Consultar ítems de recibos (acciones y multas) del usuario para el año en curso
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

  // Agrupar las acciones compradas y multas pagadas por mes
  const sharesByMonth = new Map<string, number>();
  const finesPaidByMonth = new Set<string>();
  for (const item of receiptItems || []) {
    if (item.concept === 'acciones') {
      const month = item.target_month;
      const count = item.share_count ?? 0;
      sharesByMonth.set(month, (sharesByMonth.get(month) ?? 0) + count);
    } else if (item.concept === 'multa_acciones') {
      finesPaidByMonth.add(item.target_month);
    }
  }

  const monthNames = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];

  let sharesOwedCount = 0;
  let sharesOwedAmount = 0;
  let finesOwedAmount = 0;
  const overdueMonthsDetails: Array<{
    month: string;
    monthName: string;
    sharesOwed: number;
    shareValue: number;
    fineOwed: number;
  }> = [];

  // Validar cada mes requerido
  for (const monthStr of monthsToValidate) {
    const approvedShares = sharesByMonth.get(monthStr) ?? 0;
    const sharesOwed = Math.max(0, rules.min_shares_per_month - approvedShares);
    
    let fineOwed = 0;
    const monthIndex = Number(monthStr.split('-')[1]) - 1;
    const monthName = monthNames[monthIndex];

    if (sharesOwed > 0) {
      reasons.push(
        `Debés comprar el mínimo de acciones (${rules.min_shares_per_month}) para ${monthName} ${currentYear}.`
      );
      accionesShortage = true;
      sharesOwedCount += sharesOwed;
      sharesOwedAmount += sharesOwed * shareValue;

      // Si además de faltar acciones hoy ya pasó el día de gracia, hay multa por mora
      const [y, m] = monthStr.split('-').map(Number);
      const limitDate = new Date(Date.UTC(y, m - 1, rules.grace_period_days));
      if (today.getTime() > limitDate.getTime()) {
        const finePaid = finesPaidByMonth.has(monthStr);
        if (!finePaid) {
          fineOwed = computeFineForMonth(monthStr, today, rules);
          if (fineOwed > 0) {
            reasons.push(`Tenés una multa pendiente por mora en acciones de ${monthName} ${currentYear}.`);
            finesPending = true;
            finesOwedAmount += fineOwed;
          }
        }
      }
    }

    if (sharesOwed > 0 || fineOwed > 0) {
      overdueMonthsDetails.push({
        month: monthStr,
        monthName,
        sharesOwed,
        shareValue,
        fineOwed
      });
    }
  }

  // 4. Consultar intereses en mora de préstamos activos
  const { data: activeLoans, error: loansError } = await supabase
    .from('loans')
    .select('id, loan_number, disbursement_number, outstanding_balance')
    .eq('user_id', userId)
    .eq('status', 'active')
    .not('disbursed_at', 'is', null);

  if (loansError) {
    console.error('Error al consultar préstamos para verificar obligaciones:', loansError);
    throw loansError;
  }

  let interestOwedAmount = 0;
  const activeLoansDetails: Array<{
    loanId: string;
    loanNumber: number | null;
    disbursementNumber: string | null;
    outstandingBalance: number;
    interestOwed: number;
  }> = [];

  for (const loan of activeLoans || []) {
    const { data: interestDebt, error: interestError } = await supabase
      .rpc('get_loan_interest_owed', { p_loan_id: loan.id });

    if (interestError) {
      console.error(`Error al consultar interés adeudado para préstamo ${loan.id}:`, interestError);
      throw interestError;
    }

    const debt = Number(interestDebt || 0);
    const name = loan.loan_number
      ? `Préstamo #${loan.loan_number}${loan.disbursement_number ? ` (${loan.disbursement_number})` : ''}`
      : 'préstamo activo';
    
    if (debt > 0) {
      reasons.push(`Tenés intereses en mora en tu ${name}.`);
      interestOwed = true;
      interestOwedAmount += debt;
    }

    activeLoansDetails.push({
      loanId: loan.id,
      loanNumber: loan.loan_number,
      disbursementNumber: loan.disbursement_number,
      outstandingBalance: Number(loan.outstanding_balance || 0),
      interestOwed: debt,
    });
  }

  const totalOwedAmount = sharesOwedAmount + finesOwedAmount + interestOwedAmount;

  return {
    isUpToDate: reasons.length === 0,
    reasons,
    accionesShortage,
    finesPending,
    interestOwed,
    sharesOwedCount,
    sharesOwedAmount,
    finesOwedAmount,
    interestOwedAmount,
    totalOwedAmount,
    overdueMonthsDetails,
    activeLoansDetails,
  };
}
