import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

// POST /api/prestamos/[id]/submit — accionista envía el préstamo para revisión del admin.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireUser();
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { user } = auth;

    const admin = createSupabaseAdminClient();

    const { data: loan, error: fetchError } = await admin
      .from('loans')
      .select('id, user_id, status, payment_plan_months')
      .eq('id', id)
      .maybeSingle();

    if (fetchError || !loan) {
      return NextResponse.json({ error: 'Préstamo no encontrado' }, { status: 404 });
    }
    if (loan.user_id !== user.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }
    if (loan.status !== 'draft') {
      return NextResponse.json({ error: 'Solo se puede enviar un préstamo en borrador' }, { status: 409 });
    }
    if (!loan.payment_plan_months) {
      return NextResponse.json({ error: 'Debes definir el plan de pagos antes de enviar' }, { status: 422 });
    }

    // Verificar que tenga al menos un ítem en el plan
    const { count } = await admin
      .from('loan_payment_plan_items')
      .select('id', { count: 'exact', head: true })
      .eq('loan_id', id);

    if (!count || count === 0) {
      return NextResponse.json({ error: 'El plan de pagos está vacío' }, { status: 422 });
    }

    const { error: updateError } = await admin
      .from('loans')
      .update({ status: 'pending_review', plan_status: null, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (updateError) {
      return NextResponse.json({ error: 'No se pudo enviar el préstamo' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('API Error POST /api/prestamos/[id]/submit:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
