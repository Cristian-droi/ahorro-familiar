import type {
  ReceiptConcept,
  ReceiptItemRow,
  ReceiptRow,
  ReceiptStatus,
  TypedSupabaseClient,
} from './types';

export type { ReceiptRow, ReceiptItemRow };

// -----------------------------------------------------------------------------
// Lecturas. Las mutaciones (crear/aprobar/rechazar) viven en endpoints de la
// API usando el service_role client — las políticas RLS de este módulo solo
// permiten SELECT al dueño o al admin.
// -----------------------------------------------------------------------------

export async function listReceiptsForUser(
  client: TypedSupabaseClient,
  userId: string,
) {
  const { data, error } = await client
    .from('receipts')
    .select(
      'id, receipt_number, user_id, status, submitted_at, reviewed_at, rejection_reason, rejection_note, payment_proof_path, total_amount',
    )
    .eq('user_id', userId)
    .order('submitted_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function listAllReceipts(
  client: TypedSupabaseClient,
  options: { status?: ReceiptStatus } = {},
) {
  let query = client
    .from('receipts')
    .select(
      'id, receipt_number, user_id, status, submitted_at, reviewed_at, reviewed_by, rejection_reason, rejection_note, payment_proof_path, total_amount',
    )
    .order('submitted_at', { ascending: false });

  if (options.status) query = query.eq('status', options.status);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

// Variante con items embebidos. Útil para el Libro de caja del admin, donde
// expandimos cada recibo en la misma pantalla y queremos evitar N+1.
export async function listAllReceiptsWithItems(
  client: TypedSupabaseClient,
  options: { status?: ReceiptStatus } = {},
) {
  let query = client
    .from('receipts')
    .select(
      'id, receipt_number, user_id, status, submitted_at, reviewed_at, reviewed_by, rejection_reason, rejection_note, payment_proof_path, total_amount, created_at, updated_at, receipt_items(*)',
    )
    .order('submitted_at', { ascending: false });

  if (options.status) query = query.eq('status', options.status);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getReceiptWithItems(
  client: TypedSupabaseClient,
  id: string,
) {
  const { data, error } = await client
    .from('receipts')
    .select(
      'id, receipt_number, user_id, status, submitted_at, reviewed_at, reviewed_by, rejection_reason, rejection_note, payment_proof_path, total_amount, created_at, updated_at, receipt_items(*)',
    )
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function listReceiptItemsByYear(
  client: TypedSupabaseClient,
  options: { userId?: string; year: number },
) {
  // Para el Extracto (accionista) y el Libro de caja (admin). El filtro por
  // año se expresa en target_month porque es lo que agrupa contablemente,
  // no submitted_at.
  const start = `${options.year}-01-01`;
  const end = `${options.year + 1}-01-01`;

  let query = client
    .from('receipt_items')
    .select(
      'id, receipt_id, concept, target_month, share_count, unit_value, amount, auto_generated, created_at, receipts!inner(id, receipt_number, user_id, status, submitted_at, reviewed_at)',
    )
    .gte('target_month', start)
    .lt('target_month', end);

  if (options.userId) {
    query = query.eq('receipts.user_id', options.userId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function countApprovedSharesForMonth(
  client: TypedSupabaseClient,
  userId: string,
  targetMonth: string, // YYYY-MM-01
) {
  // Suma de acciones (concept='acciones') ya compradas por el usuario para
  // ese target_month en recibos pending+approved. Útil para mostrar cuánto
  // más puede comprar antes de enviar el formulario.
  const { data, error } = await client
    .from('receipt_items')
    .select('share_count, receipts!inner(user_id, status)')
    .eq('concept', 'acciones')
    .eq('target_month', targetMonth)
    .eq('receipts.user_id', userId)
    .in('receipts.status', ['pending', 'approved']);

  if (error) throw error;
  return (data ?? []).reduce((sum, row) => sum + (row.share_count ?? 0), 0);
}

export async function listApprovedAccionesForYear(
  client: TypedSupabaseClient,
  userId: string,
  year: number,
) {
  // Para calcular multas y estado mes a mes del accionista. Solo recibos
  // aprobados cuentan para el saldo.
  const start = `${year}-01-01`;
  const end = `${year + 1}-01-01`;

  const { data, error } = await client
    .from('receipt_items')
    .select(
      'target_month, share_count, amount, concept, receipts!inner(status, user_id)',
    )
    .eq('receipts.user_id', userId)
    .eq('receipts.status', 'approved')
    .gte('target_month', start)
    .lt('target_month', end);

  if (error) throw error;
  return data ?? [];
}

export function isSupportedConceptForPurchase(
  concept: ReceiptConcept,
): boolean {
  // Solo 'acciones' está habilitado en la UI por ahora. El selector mostrará
  // los demás deshabilitados. La API rechaza cualquiera distinto de 'acciones'
  // (excepto 'multa_acciones', que solo se genera automáticamente).
  return concept === 'acciones';
}
