import { describe, it, expect } from 'vitest';
import {
  votantesHabilitados,
  validarVotante,
  votosNecesarios,
  resultadoDeVotacion,
  progresoDeVotacion,
} from '@/modules/prestamos/domain/votacion';

describe('votantesHabilitados (RN-4.6)', () => {
  it('counts every active shareholder except the applicant', () => {
    const activos = Array.from({ length: 20 }, (_, i) => `a${i}`);
    expect(votantesHabilitados({ accionistasActivos: activos, solicitanteId: 'a3' })).toBe(19);
  });

  it('counts everyone when the applicant is not in the active list', () => {
    expect(votantesHabilitados({ accionistasActivos: ['a1', 'a2'], solicitanteId: 'x' })).toBe(2);
  });

  it('counts a repeated id once', () => {
    expect(votantesHabilitados({ accionistasActivos: ['a1', 'a1', 'a2'], solicitanteId: 'a2' })).toBe(1);
  });
});

describe('validarVotante (RN-4.6)', () => {
  it('rejects the applicant voting on their own loan', () => {
    const r = validarVotante({ votanteId: 'a1', solicitanteId: 'a1' });
    expect(r).toEqual({
      ok: false,
      error: { codigo: 'solicitante_no_vota', mensaje: 'No puedes votar en tu propio préstamo.' },
    });
  });

  it('accepts any other shareholder', () => {
    expect(validarVotante({ votanteId: 'a2', solicitanteId: 'a1' }).ok).toBe(true);
  });
});

describe('votosNecesarios (RN-4.7)', () => {
  it.each([
    [19, 10],
    [20, 11],
    [1, 1],
    [2, 2],
  ])('n = %i needs %i votes in favor', (n, esperado) => {
    expect(votosNecesarios(n)).toBe(esperado);
  });
});

describe('resultadoDeVotacion (RN-4.7, RN-4.8)', () => {
  it('matches the rule example: n = 19 is approved with 10 votes in favor', () => {
    const r = resultadoDeVotacion({ votantes: 19, aFavor: 10, enContra: 0 });
    expect(r).toEqual({ ok: true, value: { estado: 'aprobado', necesarios: 10, observacion: null } });
  });

  it('stays open with 9 votes in favor and 9 against out of 19', () => {
    const r = resultadoDeVotacion({ votantes: 19, aFavor: 9, enContra: 9 });
    expect(r.ok && r.value.estado).toBe('en_votacion');
  });

  it('matches the rule example: n = 19 is rejected automatically at 10 votes against', () => {
    const r = resultadoDeVotacion({ votantes: 19, aFavor: 0, enContra: 10 });
    expect(r).toEqual({
      ok: true,
      value: {
        estado: 'rechazado',
        necesarios: 10,
        observacion: 'Rechazado por votación: 10 en contra de 19 votantes',
      },
    });
  });

  it('counts votes in favor, not participation: abstentions never block approval', () => {
    // 10 in favor, 0 against, 9 never voted.
    const r = resultadoDeVotacion({ votantes: 19, aFavor: 10, enContra: 0 });
    expect(r.ok && r.value.estado).toBe('aprobado');
  });

  it('rejects as soon as approval is impossible on an even n', () => {
    // n = 20 needs 11: with 9 against the other 11 can still approve, with 10 they cannot.
    const abierto = resultadoDeVotacion({ votantes: 20, aFavor: 0, enContra: 9 });
    expect(abierto.ok && abierto.value.estado).toBe('en_votacion');
    const r = resultadoDeVotacion({ votantes: 20, aFavor: 0, enContra: 10 });
    expect(r.ok && r.value.estado).toBe('rechazado');
  });

  it('stays open with no votes cast', () => {
    const r = resultadoDeVotacion({ votantes: 19, aFavor: 0, enContra: 0 });
    expect(r).toEqual({ ok: true, value: { estado: 'en_votacion', necesarios: 10, observacion: null } });
  });

  it('rejects with a single voter who votes against', () => {
    const r = resultadoDeVotacion({ votantes: 1, aFavor: 0, enContra: 1 });
    expect(r.ok && r.value.observacion).toBe('Rechazado por votación: 1 en contra de 1 votante');
  });

  it.each([
    [{ votantes: 0, aFavor: 0, enContra: 0 }, 'sin_votantes'],
    [{ votantes: 19, aFavor: -1, enContra: 0 }, 'votos_invalidos'],
    [{ votantes: 19, aFavor: 1.5, enContra: 0 }, 'votos_invalidos'],
    [{ votantes: 19, aFavor: 10, enContra: 10 }, 'mas_votos_que_votantes'],
  ])('returns an error for %o', (params, codigo) => {
    const r = resultadoDeVotacion(params);
    expect(!r.ok && r.error.codigo).toBe(codigo);
  });
});

describe('progresoDeVotacion (RN-4.9b)', () => {
  it('matches the rule example: "A favor 7 · En contra 3 · Votaron 10 de 19"', () => {
    const r = progresoDeVotacion({ votantes: 19, aFavor: 7, enContra: 3 });
    expect(r).toEqual({
      ok: true,
      value: { aFavor: 7, enContra: 3, votaron: 10, votantes: 19, texto: 'A favor 7 · En contra 3 · Votaron 10 de 19' },
    });
  });

  it('returns only totals, never who voted', () => {
    const r = progresoDeVotacion({ votantes: 19, aFavor: 7, enContra: 3 });
    expect(r.ok && Object.keys(r.value).sort()).toEqual(['aFavor', 'enContra', 'texto', 'votantes', 'votaron']);
  });

  it('rejects more votes than voters', () => {
    const r = progresoDeVotacion({ votantes: 2, aFavor: 2, enContra: 1 });
    expect(!r.ok && r.error.codigo).toBe('mas_votos_que_votantes');
  });
});
