import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { reviewPlanSchema } from '@/lib/schemas/loan';

// POST /api/prestamos/[id]/review — admin aprueba o rechaza el plan de pagos.
// Al aprobar el plan, el admin luego decide cuándo mandarlo a votación.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const authCheck = await requireAdmin();
    if ('error' in authCheck) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const body = await request.json();
    const parsed = reviewPlanSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
    }
    const { action, rejection_reason, admin_notes } = parsed.data;

    if (action === 'reject' && !rejection_reason) {
      return NextResponse.json({ error: 'Debes indicar un motivo de rechazo' }, { status: 422 });
    }

    const admin = createSupabaseAdminClient();

    const { data: loan, error: fetchError } = await admin
      .from('loans')
      .select('id, status')
      .eq('id', id)
      .maybeSingle();

    if (fetchError || !loan) {
      return NextResponse.json({ error: 'Préstamo no encontrado' }, { status: 404 });
    }
    if (loan.status !== 'pending_review') {
      return NextResponse.json({ error: `El préstamo no está en revisión (estado: ${loan.status})` }, { status: 409 });
    }

    const updates =
      action === 'approve'
        ? {
            plan_status: 'approved',
            plan_rejection_reason: null,
            admin_notes: admin_notes ?? null,
            updated_at: new Date().toISOString(),
          }
        : {
            plan_status: 'rejected',
            plan_rejection_reason: rejection_reason,
            admin_notes: admin_notes ?? null,
            status: 'rejected_by_admin',
            rejection_reason,
            updated_at: new Date().toISOString(),
          };

    const { error: updateError } = await admin
      .from('loans')
      .update(updates)
      .eq('id', id);

    if (updateError) {
      return NextResponse.json({ error: 'No se pudo actualizar el préstamo' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('API Error POST /api/prestamos/[id]/review:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
