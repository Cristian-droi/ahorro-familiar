import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rejectReceiptPayload } from '@/lib/schemas/receipt';

// POST /api/receipts/[id]/reject — rechazo por parte del admin.
//
// Body: { reason: 'amount_mismatch' | 'payment_not_received', note?: string }
//
// Deja el recibo en 'rejected' con reviewed_at/reviewed_by y el motivo.
// El accionista luego podrá editarlo y reenviarlo vía POST /resubmit,
// manteniendo el mismo receipt_number.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: receiptId } = await params;

    const authCheck = await requireAdmin();
    if ('error' in authCheck) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status },
      );
    }
    const { user: admin_user } = authCheck;

    const parsed = rejectReceiptPayload.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { reason, note } = parsed.data;

    const admin = createSupabaseAdminClient();

    const { data: receipt, error: fetchError } = await admin
      .from('receipts')
      .select('id, status')
      .eq('id', receiptId)
      .maybeSingle();

    if (fetchError) {
      console.error('Error leyendo recibo:', fetchError);
      return NextResponse.json(
        { error: 'No se pudo leer el recibo' },
        { status: 500 },
      );
    }
    if (!receipt) {
      return NextResponse.json({ error: 'Recibo no encontrado' }, { status: 404 });
    }
    if (receipt.status !== 'pending') {
      return NextResponse.json(
        { error: `El recibo ya está ${receipt.status}` },
        { status: 409 },
      );
    }

    const { error: updateError } = await admin
      .from('receipts')
      .update({
        status: 'rejected',
        reviewed_at: new Date().toISOString(),
        reviewed_by: admin_user.id,
        rejection_reason: reason,
        rejection_note: note ?? null,
      })
      .eq('id', receiptId);

    if (updateError) {
      console.error('Error rechazando recibo:', updateError);
      return NextResponse.json(
        { error: 'No se pudo rechazar el recibo' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('API Error POST /api/receipts/[id]/reject:', err);
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 },
    );
  }
}
