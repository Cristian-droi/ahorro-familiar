import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { voteSchema } from '@/lib/schemas/loan';
import { getShareholderIds } from '@/lib/data/votes';
import { resultadoDeVotacion, validarVotante, votantesHabilitados } from '@/modules/prestamos/domain/votacion';

// POST /api/prestamos/[id]/vote — accionista emite su voto.
// RN-4.6 a RN-4.8: votan los accionistas excepto el solicitante. Con
// ⌊n/2⌋ + 1 votos a favor pasa a pending_disbursement; apenas aprobar es
// imposible se rechaza con la observación del dominio.
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
    const votante = validarVotante({ votanteId: user.id, solicitanteId: loan.user_id });
    if (!votante.ok) {
      return NextResponse.json({ error: votante.error.mensaje }, { status: 403 });
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

    // Contar votos actuales y votantes habilitados (n excluye al solicitante)
    const [votesRes, shareholderIds] = await Promise.all([
      admin.from('loan_votes').select('vote').eq('loan_id', id),
      getShareholderIds(admin),
    ]);

    const votes = votesRes.data ?? [];
    const eligibleVoters = votantesHabilitados({ accionistasActivos: shareholderIds, solicitanteId: loan.user_id });
    const approved = votes.filter((v) => v.vote === 'approved').length;
    const rejected = votes.filter((v) => v.vote === 'rejected').length;

    const resultado = resultadoDeVotacion({ votantes: eligibleVoters, aFavor: approved, enContra: rejected });
    if (!resultado.ok) {
      console.error('Conteo de votos inválido:', resultado.error.codigo);
      return NextResponse.json({ error: resultado.error.mensaje }, { status: 409 });
    }
    const { estado, necesarios, observacion } = resultado.value;

    const newStatus =
      estado === 'aprobado' ? 'pending_disbursement' : estado === 'rechazado' ? 'rejected_by_shareholders' : null;

    if (newStatus) {
      await admin
        .from('loans')
        .update({
          status: newStatus,
          rejection_reason: newStatus === 'rejected_by_shareholders' ? observacion : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
    }

    return NextResponse.json({
      success: true,
      approved,
      rejected,
      needed: necesarios,
      total_active: eligibleVoters,
      new_status: newStatus,
    });
  } catch (err) {
    console.error('API Error POST /api/prestamos/[id]/vote:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
