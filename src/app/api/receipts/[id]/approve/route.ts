import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

// POST /api/receipts/[id]/approve — aprobación por parte del admin.
//
// Pasa el recibo a 'approved' y registra reviewed_at/reviewed_by. El trigger
// `lock_share_value_on_approval` congela share_value_change_allowed del
// accionista si es la primera vez que aprueba un concepto 'acciones'.

export async function POST(
  _request: Request,
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
        status: 'approved',
        reviewed_at: new Date().toISOString(),
        reviewed_by: admin_user.id,
        rejection_reason: null,
        rejection_note: null,
      })
      .eq('id', receiptId);

    if (updateError) {
      console.error('Error aprobando recibo:', updateError);
      return NextResponse.json(
        { error: 'No se pudo aprobar el recibo' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('API Error POST /api/receipts/[id]/approve:', err);
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 },
    );
  }
}
