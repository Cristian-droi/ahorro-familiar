import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { voteSchema } from '@/lib/schemas/loan';
import { getShareholderIds } from '@/lib/data/votes';
import { EXPIRED_REQUEST_MESSAGE, expireLoanRequestIfDue } from '@/lib/loan-expiry';
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
      .select('id, status, user_id, submitted_at')
      .eq('id', id)
      .maybeSingle();

    if (loanError || !loan) {
      return NextResponse.json({ error: 'Préstamo no encontrado' }, { status: 404 });
    }
    // RN-4.5b: an expired request is annulled before any vote.
    if (await expireLoanRequestIfDue(admin, loan)) {
      return NextResponse.json({ error: EXPIRED_REQUEST_MESSAGE }, { status: 409 });
    }
    if (loan.status !== 'pending_shareholder_vote') {
      return NextResponse.json({ error: 'Este préstamo no está en votación' }, { status: 409 });
    }
    const votante = validarVotante({ votanteId: user.id, solicitanteId: loan.user_id });
    if (!votante.ok) {
      return NextResponse.json({ error: votante.error.mensaje }, { status: 403 });
    }

    // Votantes habilitados: accionistas sin el solicitante (RN-4.6).
    const shareholderIds = await getShareholderIds(admin);
    const habilitados = new Set(shareholderIds.filter((voterId) => voterId !== loan.user_id));
    const eligibleVoters = votantesHabilitados({ accionistasActivos: shareholderIds, solicitanteId: loan.user_id });
    if (!habilitados.has(user.id)) {
      return NextResponse.json({ error: 'No estás habilitado para votar en este préstamo.' }, { status: 403 });
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

    // Only votes from eligible voters count, so the tally never exceeds n.
    const contar = (votos: { vote: string; voter_id: string }[]) => {
      const validos = votos.filter((v) => habilitados.has(v.voter_id));
      return {
        aFavor: validos.filter((v) => v.vote === 'approved').length,
        enContra: validos.filter((v) => v.vote === 'rejected').length,
      };
    };

    // Validate the tally with this vote BEFORE storing it, so a rejected
    // count never leaves a stored vote behind an error response.
    const { data: previos, error: previosError } = await admin
      .from('loan_votes')
      .select('vote, voter_id')
      .eq('loan_id', id);
    if (previosError) {
      console.error('No se pudieron leer los votos antes de votar:', previosError);
      return NextResponse.json({ error: 'No se pudo registrar el voto' }, { status: 500 });
    }
    const conteoPrevio = contar([...(previos ?? []), { vote: parsed.data.vote, voter_id: user.id }]);
    const previo = resultadoDeVotacion({ votantes: eligibleVoters, ...conteoPrevio });
    if (!previo.ok) {
      console.error('Conteo de votos inválido antes de votar:', previo.error.codigo);
      return NextResponse.json({ error: previo.error.mensaje }, { status: 409 });
    }

    // Registrar voto
    const { error: voteError } = await admin
      .from('loan_votes')
      .insert({ loan_id: id, voter_id: user.id, vote: parsed.data.vote, comment: parsed.data.comment ?? null });

    if (voteError) {
      return NextResponse.json({ error: 'No se pudo registrar el voto' }, { status: 500 });
    }

    // Recount after storing: other votes may have arrived meanwhile.
    const { data: votos, error: votosError } = await admin
      .from('loan_votes')
      .select('vote, voter_id')
      .eq('loan_id', id);
    // If the recount cannot be read or is invalid, fall back to the tally
    // validated before the insert, which already includes this vote, so the
    // deciding vote still updates the loan status.
    if (votosError) console.error('No se pudieron recontar los votos:', votosError);
    const recuento = votosError ? null : contar(votos ?? []);
    const actual = recuento ? resultadoDeVotacion({ votantes: eligibleVoters, ...recuento }) : null;
    if (actual && !actual.ok) console.error('Conteo de votos inválido después de votar:', actual.error.codigo);
    const usarActual = recuento !== null && actual !== null && actual.ok;
    const { aFavor: approved, enContra: rejected } = usarActual ? recuento : conteoPrevio;
    const resultado = usarActual ? actual : previo;
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
