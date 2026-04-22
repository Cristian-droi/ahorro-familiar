import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { resubmitReceiptPayload } from '@/lib/schemas/receipt';
import { getProfile } from '@/lib/data/profiles';
import {
  buildReceiptItems,
  loadPurchaseRules,
  mapReceiptItemError,
} from '@/lib/receipts-build';

// POST /api/receipts/[id]/resubmit — el accionista edita un recibo que fue
// rechazado y lo vuelve a enviar.
//
// Se conserva el mismo receipt_number. Se reemplazan todas las líneas
// (incluidas multas, que se recalculan al momento del reenvío porque ese
// pago no llegó a contar).
//
// Flujo:
//   1. Auth; dueño y estado 'rejected' obligatorios.
//   2. Borra los receipt_items existentes.
//   3. Recalcula líneas (acciones + multas) excluyendo este mismo recibo
//      del conteo de multas previas, porque al estar rechazado no cuenta.
//   4. Inserta nuevas líneas.
//   5. Update receipts: status='pending', limpia review fields, actualiza
//      payment_proof_path.

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
    const { items, payment_proof_path } = parsed.data;

    if (!payment_proof_path.startsWith(`${user.id}/`)) {
      return NextResponse.json(
        { error: 'Ruta de comprobante inválida' },
        { status: 400 },
      );
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

    const profile = await getProfile(admin, user.id);
    if (!profile.selected_share_value) {
      return NextResponse.json(
        { error: 'Debes seleccionar tu valor de acción antes de comprar' },
        { status: 409 },
      );
    }
    const unitValue = Number(profile.selected_share_value);

    const rules = await loadPurchaseRules(admin);
    const { items: builtItems } = await buildReceiptItems(admin, {
      userId: user.id,
      unitValue,
      items,
      rules,
      excludeReceiptId: receiptId,
    });

    // Reemplazar líneas: primero borrar, luego insertar.
    const { error: deleteError } = await admin
      .from('receipt_items')
      .delete()
      .eq('receipt_id', receiptId);

    if (deleteError) {
      console.error('Error borrando items previos:', deleteError);
      return NextResponse.json(
        { error: 'No se pudieron limpiar las líneas anteriores' },
        { status: 500 },
      );
    }

    const { error: insertItemsError } = await admin
      .from('receipt_items')
      .insert(builtItems.map((it) => ({ ...it, receipt_id: receiptId })));

    if (insertItemsError) {
      const friendly = mapReceiptItemError(insertItemsError);
      if (friendly) return NextResponse.json(friendly, { status: 400 });
      console.error('Error insertando items:', insertItemsError);
      return NextResponse.json(
        { error: 'No se pudieron registrar las compras' },
        { status: 500 },
      );
    }

    // Volver a pending y limpiar campos de revisión. submitted_at se
    // actualiza para que la bandeja del admin lo trate como nuevo.
    const { error: updateError } = await admin
      .from('receipts')
      .update({
        status: 'pending',
        submitted_at: new Date().toISOString(),
        reviewed_at: null,
        reviewed_by: null,
        rejection_reason: null,
        rejection_note: null,
        payment_proof_path,
      })
      .eq('id', receiptId);

    if (updateError) {
      console.error('Error actualizando recibo:', updateError);
      return NextResponse.json(
        { error: 'No se pudo reenviar el recibo' },
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
