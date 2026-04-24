import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { voteSchema } from '@/lib/schemas/loan';
import { requiredVotes } from '@/lib/loans';

// POST /api/prestamos/[id]/vote — accionista emite su voto.
// Al alcanzar el quórum se pasa a pending_disbursement.
// Si los rechazos hacen imposible el quórum, se rechaza.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireUser();
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { user, role } = auth;

    if (role !== 'accionista') {
      return NextResponse.json({ error: 'Solo los accionistas pueden votar' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = voteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();

    // Verificar estado del préstamo
    const { data: loan, error: loanError } = await admin
      .from('loans')
      .select('id, status, user_id')
      .eq('id', id)
      .maybeSingle();

    if (loanError || !loan) {
      return NextResponse.json({ error: 'Préstamo no encontrado' }, { status: 404 });
    }
    if (loan.status !== 'pending_shareholder_vote') {
      return NextResponse.json({ error: 'Este préstamo no está en votación' }, { status: 409 });
    }
    if (loan.user_id === user.id) {
      return NextResponse.json({ error: 'No puedes votar en tu propio préstamo' }, { status: 403 });
    }

    // Verificar si ya votó
    const { data: existing } = await admin
      .from('loan_votes')
      .select('id')
      .eq('loan_id', id)
      .eq('voter_id', user.id)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: 'Ya emitiste tu voto para este préstamo' }, { status: 409 });
    }

    // Registrar voto
    const { error: voteError } = await admin
      .from('loan_votes')
      .insert({ loan_id: id, voter_id: user.id, vote: parsed.data.vote, comment: parsed.data.comment ?? null });

    if (voteError) {
      return NextResponse.json({ error: 'No se pudo registrar el voto' }, { status: 500 });
    }

    // Contar votos actuales y total de accionistas activos
    const [votesRes, totalRes] = await Promise.all([
      admin.from('loan_votes').select('vote').eq('loan_id', id),
      admin.rpc('count_active_shareholders'),
    ]);

    const votes = votesRes.data ?? [];
    const totalActive = Number(totalRes.data ?? 0);
    const approved = votes.filter((v) => v.vote === 'approved').length;
    const rejected = votes.filter((v) => v.vote === 'rejected').length;
    const needed = requiredVotes(totalActive);

    let newStatus: string | null = null;

    if (approved >= needed) {
      newStatus = 'pending_disbursement';
    } else {
      // Si los rechazos hacen imposible alcanzar el quórum
      const remaining = totalActive - votes.length;
      if (rejected > 0 && approved + remaining < needed) {
        newStatus = 'rejected_by_shareholders';
      }
    }

    if (newStatus) {
      await admin
        .from('loans')
        .update({
          status: newStatus,
          rejection_reason: newStatus === 'rejected_by_shareholders' ? 'No se alcanzó el quórum de aprobación' : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
    }

    return NextResponse.json({
      success: true,
      approved,
      rejected,
      needed,
      total_active: totalActive,
      new_status: newStatus,
    });
  } catch (err) {
    console.error('API Error POST /api/prestamos/[id]/vote:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
