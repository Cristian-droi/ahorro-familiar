// Shareholder vote on a loan (docs/reglas-negocio.md, RN-4.6 to RN-4.9b).
// The domain only works with totals: who voted what never enters or leaves
// these functions (RN-4.9b, secret vote).

import { ok, err, type Result, type ErrorDeDominio } from '@/shared/domain/result';

// RN-4.6: every active shareholder except the applicant votes.
export function votantesHabilitados(params: { accionistasActivos: string[]; solicitanteId: string }): number {
  const votantes = new Set(params.accionistasActivos);
  votantes.delete(params.solicitanteId);
  return votantes.size;
}

// RN-4.6: the applicant never votes on their own loan.
export function validarVotante(params: { votanteId: string; solicitanteId: string }): Result<true, ErrorDeDominio> {
  if (params.votanteId === params.solicitanteId) {
    return err({ codigo: 'solicitante_no_vota', mensaje: 'No puedes votar en tu propio préstamo.' });
  }
  return ok(true);
}

// RN-4.7: ⌊n/2⌋ + 1 votes in favor.
export function votosNecesarios(votantes: number): number {
  return Math.floor(votantes / 2) + 1;
}

export interface ConteoDeVotos {
  // n, from `votantesHabilitados`.
  votantes: number;
  aFavor: number;
  enContra: number;
}

function validarConteo({ votantes, aFavor, enContra }: ConteoDeVotos): ErrorDeDominio | null {
  if (!Number.isInteger(votantes) || votantes < 1) {
    return { codigo: 'sin_votantes', mensaje: 'La votación necesita al menos un votante habilitado.' };
  }
  if (!Number.isInteger(aFavor) || !Number.isInteger(enContra) || aFavor < 0 || enContra < 0) {
    return { codigo: 'votos_invalidos', mensaje: 'Los votos deben ser números enteros no negativos.' };
  }
  if (aFavor + enContra > votantes) {
    return { codigo: 'mas_votos_que_votantes', mensaje: 'Hay más votos que votantes habilitados.' };
  }
  return null;
}

export type EstadoDeVotacion = 'aprobado' | 'rechazado' | 'en_votacion';

export interface ResultadoDeVotacion {
  estado: EstadoDeVotacion;
  necesarios: number;
  // RN-4.8: the observation recorded with an automatic rejection.
  observacion: string | null;
}

export function resultadoDeVotacion(conteo: ConteoDeVotos): Result<ResultadoDeVotacion, ErrorDeDominio> {
  const invalido = validarConteo(conteo);
  if (invalido) return err(invalido);

  const { votantes, aFavor, enContra } = conteo;
  const necesarios = votosNecesarios(votantes);

  // RN-4.7: votes in favor count, not participation.
  if (aFavor >= necesarios) return ok({ estado: 'aprobado', necesarios, observacion: null });

  // RN-4.8: reject as soon as approval is impossible.
  if (enContra > votantes - necesarios) {
    const sustantivo = votantes === 1 ? 'votante' : 'votantes';
    return ok({
      estado: 'rechazado',
      necesarios,
      observacion: `Rechazado por votación: ${enContra} en contra de ${votantes} ${sustantivo}`,
    });
  }
  return ok({ estado: 'en_votacion', necesarios, observacion: null });
}

export interface ProgresoDeVotacion {
  aFavor: number;
  enContra: number;
  votaron: number;
  votantes: number;
  texto: string;
}

// RN-4.9b: everyone sees the progress as totals, never the list of voters.
export function progresoDeVotacion(conteo: ConteoDeVotos): Result<ProgresoDeVotacion, ErrorDeDominio> {
  const invalido = validarConteo(conteo);
  if (invalido) return err(invalido);

  const { votantes, aFavor, enContra } = conteo;
  const votaron = aFavor + enContra;
  return ok({
    aFavor,
    enContra,
    votaron,
    votantes,
    texto: `A favor ${aFavor} · En contra ${enContra} · Votaron ${votaron} de ${votantes}`,
  });
}
