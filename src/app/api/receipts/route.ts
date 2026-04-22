import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createReceiptPayload } from '@/lib/schemas/receipt';
import { getProfile } from '@/lib/data/profiles';
import {
  buildReceiptItems,
  loadPurchaseRules,
  mapReceiptItemError,
} from '@/lib/receipts-build';

// POST /api/receipts — crea un recibo pending para el accionista autenticado.
//
// Flujo:
//   1. Auth + validación del payload.
//   2. Snapshot del valor de acción desde el profile (requerido).
//   3. Calcula multas de mora por cada target_month distinto (si aplica y si
//      aún no existe una multa_acciones pendiente/aprobada para ese mes).
//   4. Inserta receipts y receipt_items con service_role (RLS bypass). Los
//      triggers de DB validan rango de mes y tope mensual de acciones.
//   5. Si la inserción de items falla, borra el receipt para evitar huérfanos.

export async function POST(request: Request) {
  try {
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
        { error: 'Solo los accionistas pueden registrar compras' },
        { status: 403 },
      );
    }

    const parsed = createReceiptPayload.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { items, payment_proof_path } = parsed.data;

    // El comprobante debe vivir dentro de la carpeta del propio usuario.
    if (!payment_proof_path.startsWith(`${user.id}/`)) {
      return NextResponse.json(
        { error: 'Ruta de comprobante inválida' },
        { status: 400 },
      );
    }

    const admin = createSupabaseAdminClient();
    const profile = await getProfile(admin, user.id);
    if (!profile.selected_share_value) {
      return NextResponse.json(
        { error: 'Debes seleccionar tu valor de acción antes de comprar' },
        { status: 409 },
      );
    }
    const unitValue = Number(profile.selected_share_value);

    const rules = await loadPurchaseRules(admin);
    const { items: builtItems, fineCount } = await buildReceiptItems(admin, {
      userId: user.id,
      unitValue,
      items,
      rules,
    });

    // Crear el receipt. receipt_number se asigna por trigger.
    const { data: receipt, error: insertReceiptError } = await admin
      .from('receipts')
      .insert({
        user_id: user.id,
        status: 'pending',
        payment_proof_path,
        total_amount: 0, // trigger lo recalcula con los items
      })
      .select('id, receipt_number')
      .single();

    if (insertReceiptError || !receipt) {
      console.error('Error insertando receipt:', insertReceiptError);
      return NextResponse.json(
        { error: 'No se pudo crear el recibo' },
        { status: 500 },
      );
    }

    const allItems = builtItems.map((it) => ({ ...it, receipt_id: receipt.id }));

    const { error: insertItemsError } = await admin
      .from('receipt_items')
      .insert(allItems);

    if (insertItemsError) {
      // Rollback manual: borrar el receipt huérfano.
      await admin.from('receipts').delete().eq('id', receipt.id);

      const friendly = mapReceiptItemError(insertItemsError);
      if (friendly) {
        return NextResponse.json(friendly, { status: 400 });
      }
      console.error('Error insertando receipt_items:', insertItemsError);
      return NextResponse.json(
        { error: 'No se pudieron registrar las compras' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      receipt: {
        id: receipt.id,
        receipt_number: receipt.receipt_number,
      },
      added_fine_count: fineCount,
    });
  } catch (err) {
    console.error('API Error POST /api/receipts:', err);
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 },
    );
  }
}
