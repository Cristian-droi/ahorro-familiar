import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

// POST /api/prestamos/[id]/send-to-vote — admin envía el préstamo a votación de accionistas.
// Solo es posible si el plan ya fue aprobado por el admin.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const authCheck = await requireAdmin();
    if ('error' in authCheck) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const admin = createSupabaseAdminClient();

    const { data: loan, error: fetchError } = await admin
      .from('loans')
      .select('id, status, plan_status')
      .eq('id', id)
      .maybeSingle();

    if (fetchError || !loan) {
      return NextResponse.json({ error: 'Préstamo no encontrado' }, { status: 404 });
    }
    if (loan.status !== 'pending_review') {
      return NextResponse.json({ error: `El préstamo no está en revisión (estado: ${loan.status})` }, { status: 409 });
    }
    if (loan.plan_status !== 'approved') {
      return NextResponse.json({ error: 'El plan debe ser aprobado antes de enviarlo a votación' }, { status: 422 });
    }

    const { error: updateError } = await admin
      .from('loans')
      .update({ status: 'pending_shareholder_vote', updated_at: new Date().toISOString() })
      .eq('id', id);

    if (updateError) {
      return NextResponse.json({ error: 'No se pudo enviar a votación' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('API Error POST /api/prestamos/[id]/send-to-vote:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
