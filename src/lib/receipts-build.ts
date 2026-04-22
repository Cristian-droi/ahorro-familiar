import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { ReceiptItemInsert } from '@/lib/data/types';
import type { PurchaseItemInput } from '@/lib/schemas/receipt';
import {
  computeFineForMonth,
  DEFAULT_PURCHASE_RULES,
  getBogotaToday,
  type PurchaseRules,
} from '@/lib/fines';

type AdminClient = SupabaseClient<Database>;

// Lee las reglas de compra desde system_settings.purchase_rules con fallback
// a los defaults.
export async function loadPurchaseRules(
  admin: AdminClient,
): Promise<PurchaseRules> {
  const { data, error } = await admin
    .from('system_settings')
    .select('value')
    .eq('key', 'purchase_rules')
    .maybeSingle();

  if (error || !data?.value) return DEFAULT_PURCHASE_RULES;
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
}

// Dado el carrito del accionista, arma las líneas de receipt_items que se
// insertarán: una línea por cada 'acciones' + (opcional) una línea de
// multa_acciones por cada mes en mora que NO tenga ya una multa registrada
// en otros recibos pending/approved del mismo usuario.
//
// `excludeReceiptId` permite al resubmit ignorar las multas del propio
// recibo que se está reemplazando.
export async function buildReceiptItems(
  admin: AdminClient,
  args: {
    userId: string;
    unitValue: number;
    items: PurchaseItemInput[];
    rules: PurchaseRules;
    excludeReceiptId?: string;
  },
): Promise<{ items: Omit<ReceiptItemInsert, 'receipt_id'>[]; fineCount: number }> {
  const { userId, unitValue, items, rules, excludeReceiptId } = args;

  const accionesSource = items.filter(
    (it): it is Extract<PurchaseItemInput, { concept: 'acciones' }> =>
      it.concept === 'acciones',
  );
  const capitalizacionSource = items.filter(
    (it): it is Extract<PurchaseItemInput, { concept: 'capitalizacion' }> =>
      it.concept === 'capitalizacion',
  );

  const accionesItems: Omit<ReceiptItemInsert, 'receipt_id'>[] =
    accionesSource.map((it) => ({
      concept: 'acciones',
      target_month: it.target_month,
      share_count: it.share_count,
      unit_value: unitValue,
      amount: it.share_count * unitValue,
      auto_generated: false,
    }));

  const capitalizacionItems: Omit<ReceiptItemInsert, 'receipt_id'>[] =
    capitalizacionSource.map((it) => ({
      concept: 'capitalizacion',
      target_month: it.target_month,
      share_count: null,
      unit_value: null,
      amount: it.amount,
      auto_generated: false,
    }));

  // Las multas de mora aplican únicamente sobre los meses comprados de
  // 'acciones'. Las capitalizaciones nunca generan multa.
  const distinctMonths = Array.from(
    new Set(accionesSource.map((it) => it.target_month)),
  );

  let existingQuery = admin
    .from('receipt_items')
    .select('target_month, receipt_id, receipts!inner(user_id, status)')
    .eq('concept', 'multa_acciones')
    .eq('receipts.user_id', userId)
    .in('receipts.status', ['pending', 'approved'])
    .in('target_month', distinctMonths);

  if (excludeReceiptId) {
    existingQuery = existingQuery.neq('receipt_id', excludeReceiptId);
  }

  const { data: existing, error } = await existingQuery;
  if (error) throw error;

  const monthsAlreadyFined = new Set(
    (existing ?? []).map((r) => r.target_month),
  );

  const todayBogota = getBogotaToday();
  const fineItems: Omit<ReceiptItemInsert, 'receipt_id'>[] = [];
  for (const month of distinctMonths) {
    if (monthsAlreadyFined.has(month)) continue;
    const fine = computeFineForMonth(month, todayBogota, rules);
    if (fine > 0) {
      fineItems.push({
        concept: 'multa_acciones',
        target_month: month,
        share_count: null,
        unit_value: null,
        amount: fine,
        auto_generated: true,
      });
    }
  }

  return {
    items: [...accionesItems, ...capitalizacionItems, ...fineItems],
    fineCount: fineItems.length,
  };
}

// Traduce errores de trigger a respuestas amigables.
export function mapReceiptItemError(err: {
  message?: string;
  hint?: string;
}): { error: string; details?: string } | null {
  const msg = err.message ?? '';
  const hint = err.hint ?? '';
  if (msg.includes('max_shares_per_month_exceeded')) {
    return {
      error: 'Una de las líneas supera el máximo de acciones permitido para ese mes.',
      details: hint || msg,
    };
  }
  if (
    msg.includes('target_month_previous_year') ||
    msg.includes('target_month_next_year') ||
    msg.includes('target_month_past')
  ) {
    return {
      error: 'Solo puedes comprar acciones del año en curso.',
      details: hint || msg,
    };
  }
  if (msg.includes('capitalization_window_closed')) {
    return {
      error: 'La ventana de capitalizaciones está cerrada.',
      details: hint || msg,
    };
  }
  if (msg.includes('capitalization_target_month_invalid')) {
    return {
      error: 'La capitalización debe asociarse al mes actual.',
      details: hint || msg,
    };
  }
  if (
    msg.includes('capitalization_has_shares') ||
    msg.includes('capitalization_has_unit_value') ||
    msg.includes('capitalization_invalid_amount')
  ) {
    return {
      error: 'La capitalización tiene valores inválidos.',
      details: hint || msg,
    };
  }
  return null;
}
