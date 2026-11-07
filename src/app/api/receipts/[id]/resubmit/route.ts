import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { resubmitReceiptPayload } from '@/lib/schemas/receipt';
import { getOpenPeriodShareValue } from '@/lib/data/share-value';
import { validarPuedeComprar } from '@/modules/acciones/domain/valor-de-accion';
import {
  buildReceiptItems,
  loadPurchaseRules,
  mapReceiptItemError,
} from '@/lib/receipts-build';
import { validateCapitalPayments } from '@/lib/receipt-capital';
import { isStaleStatus, resubmitReceipt } from '@/lib/audit';

// POST /api/receipts/[id]/resubmit — el accionista edita un recibo que fue
// rechazado y lo vuelve a enviar.
//
// Se conserva el mismo receipt_number. Se reemplazan todas las líneas
// (incluidas multas, que se recalculan al momento del reenvío porque ese
// pago no llegó a contar).
//
// Flujo:
//   1. Auth; dueño y estado 'rejected' obligatorios.
//   2. Recalcula líneas (acciones + multas) excluyendo este mismo recibo
//      del conteo de multas previas, porque al estar rechazado no cuenta.
//   3. En una sola transacción (resubmit_receipt): reemplaza las líneas,
//      vuelve a status='pending', limpia review fields, actualiza
//      payment_proof_path y deja el registro de auditoría.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: receiptId } = await params;

    const authCheck = await requireUser();
    if ('error' in authCheck) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status },
      );
    }
    const { user, role } = authCheck;
    if (role !== 'accionista') {
      return NextResponse.json(
        { error: 'Solo los accionistas pueden reenviar recibos' },
        { status: 403 },
      );
    }

    const parsed = resubmitReceiptPayload.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { items, payment_method, bank_account_id, payment_proof_path } = parsed.data;

    if (payment_method === 'transfer') {
      if (!payment_proof_path || !payment_proof_path.startsWith(`${user.id}/`)) {
        return NextResponse.json(
          { error: 'Ruta de comprobante inválida o faltante para transferencia' },
          { status: 400 },
        );
      }
    }

    const admin = createSupabaseAdminClient();

    // Dueño + estado del recibo.
    const { data: existing, error: fetchError } = await admin
      .from('receipts')
      .select('id, user_id, status')
      .eq('id', receiptId)
      .maybeSingle();

    if (fetchError) {
      console.error('Error leyendo recibo:', fetchError);
      return NextResponse.json(
        { error: 'No se pudo leer el recibo' },
        { status: 500 },
      );
    }
    if (!existing) {
      return NextResponse.json({ error: 'Recibo no encontrado' }, { status: 404 });
    }
    if (existing.user_id !== user.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }
    if (existing.status !== 'rejected') {
      return NextResponse.json(
        { error: 'Solo puedes reenviar recibos que fueron rechazados' },
        { status: 409 },
      );
    }

    const puedeComprar = validarPuedeComprar({
      valorDeAccion: await getOpenPeriodShareValue(admin, user.id),
    });
    if (!puedeComprar.ok) {
      return NextResponse.json({ error: puedeComprar.error.mensaje }, { status: 400 });
    }
    const unitValue = puedeComprar.value;

    const capital = await validateCapitalPayments(admin, {
      items,
      countPending: true,
      excludeReceiptId: receiptId,
      ownerId: user.id,
    });
    if (!capital.ok) {
      return NextResponse.json({ error: capital.error.mensaje }, { status: 400 });
    }

    const rules = await loadPurchaseRules(admin);
    const { items: builtItems } = await buildReceiptItems(admin, {
      userId: user.id,
      unitValue,
      items,
      rules,
      excludeReceiptId: receiptId,
    });

    // Reemplazar líneas y volver a pending en una sola transacción (F24).
    // submitted_at se actualiza para que la bandeja del admin lo trate como nuevo.
    const { error: resubmitError } = await resubmitReceipt(admin, {
      id: receiptId,
      actorId: user.id,
      items: builtItems,
      patch: {
        status: 'pending',
        submitted_at: new Date().toISOString(),
        reviewed_at: null,
        reviewed_by: null,
        rejection_reason: null,
        rejection_note: null,
        payment_method,
        bank_account_id: payment_method === 'transfer' ? bank_account_id : null,
        payment_proof_path: payment_method === 'transfer' ? payment_proof_path : null,
      },
    });

    if (isStaleStatus(resubmitError)) {
      return NextResponse.json(
        { error: 'Solo puedes reenviar recibos que fueron rechazados' },
        { status: 409 },
      );
    }
    if (resubmitError) {
      const friendly = mapReceiptItemError(resubmitError);
      if (friendly) return NextResponse.json(friendly, { status: 400 });
      console.error('Error reenviando recibo:', resubmitError);
      return NextResponse.json(
        { error: 'No se pudieron registrar las compras' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('API Error POST /api/receipts/[id]/resubmit:', err);
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 },
    );
  }
}
