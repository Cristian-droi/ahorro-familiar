import { describe, it, expect, vi, afterEach } from 'vitest';
import { crearFecha, type FechaISO } from '@/shared/domain/fechas';
import {
  AJUSTE_DIA_DE_CORTE,
  AJUSTE_DIA_LIMITE_TASA_COMPLETA,
  AJUSTE_PLAZO_HASTA_PERIODO_SIGUIENTE,
  ajustesDePrestamoDesdeFilas,
  leerAjustesDePrestamoDesdeFilas,
  getAjustesDePrestamo,
  reglasDeInteresDelPrestamo,
  reglasDeInteresDesdeAjuste,
} from '@/lib/loan-settings';
import { buildPaymentPlan, calcAccruedInterest, summarizeActiveLoanDebt } from '@/lib/loans';
import type { TypedSupabaseClient } from '@/lib/data/types';

function fecha(texto: string): FechaISO {
  const r = crearFecha(texto);
  if (!r.ok) throw new Error(`Invalid test date: ${texto}`);
  return r.value;
}

const DEFECTO = { diaLimiteTasaCompleta: 15, diaDeCorte: 25, plazoHastaPeriodoSiguiente: false };

describe('setting keys (section 10)', () => {
  it('names the three loan settings', () => {
    expect([AJUSTE_DIA_LIMITE_TASA_COMPLETA, AJUSTE_DIA_DE_CORTE, AJUSTE_PLAZO_HASTA_PERIODO_SIGUIENTE]).toEqual([
      'loan_full_rate_day_limit',
      'loan_cutoff_day',
      'loan_extended_term_enabled',
    ]);
  });
});

describe('ajustesDePrestamoDesdeFilas (RN-4.20, RN-4.21, RN-4.3)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses the defaults 15, 25 and no extended term when the keys are missing', () => {
    expect(ajustesDePrestamoDesdeFilas([])).toEqual(DEFECTO);
  });

  it('reads the stored values', () => {
    expect(
      ajustesDePrestamoDesdeFilas([
        { key: 'loan_full_rate_day_limit', value: 10 },
        { key: 'loan_cutoff_day', value: 20 },
        { key: 'loan_extended_term_enabled', value: true },
      ]),
    ).toEqual({ diaLimiteTasaCompleta: 10, diaDeCorte: 20, plazoHastaPeriodoSiguiente: true });
  });

  it('logs and falls back to the default of an invalid value', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(ajustesDePrestamoDesdeFilas([{ key: 'loan_cutoff_day', value: 31 }])).toEqual(DEFECTO);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('El día de corte debe ser un número entero entre 2 y 28.'));
  });

  it('logs and falls back to every default when the day limit is not before the cut-off day', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      ajustesDePrestamoDesdeFilas([
        { key: 'loan_full_rate_day_limit', value: 26 },
        { key: 'loan_extended_term_enabled', value: true },
      ]),
    ).toEqual(DEFECTO);
    expect(log).toHaveBeenCalledOnce();
  });
});

describe('leerAjustesDePrestamoDesdeFilas (R3-001)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reports no invalid key when the values are missing or valid', () => {
    expect(leerAjustesDePrestamoDesdeFilas([])).toEqual({ ajustes: DEFECTO, clavesInvalidas: [] });
    expect(
      leerAjustesDePrestamoDesdeFilas([
        { key: 'loan_full_rate_day_limit', value: 10 },
        { key: 'loan_cutoff_day', value: 20 },
      ]).clavesInvalidas,
    ).toEqual([]);
  });

  it('reports the key of an invalid stored value shown as its default', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(leerAjustesDePrestamoDesdeFilas([{ key: 'loan_cutoff_day', value: 31 }])).toEqual({
      ajustes: DEFECTO,
      clavesInvalidas: ['loan_cutoff_day'],
    });
  });

  it('reports every stored key when inconsistent days make all defaults apply', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      leerAjustesDePrestamoDesdeFilas([
        { key: 'loan_full_rate_day_limit', value: 26 },
        { key: 'loan_extended_term_enabled', value: true },
      ]),
    ).toEqual({
      ajustes: DEFECTO,
      clavesInvalidas: ['loan_full_rate_day_limit', 'loan_extended_term_enabled'],
    });
  });
});

function clienteFalso(resultado: { data: unknown; error: unknown }) {
  const llamadas: { tabla?: string; claves?: unknown } = {};
  const client = {
    from(tabla: string) {
      llamadas.tabla = tabla;
      return {
        select() {
          return {
            in(_columna: string, claves: unknown) {
              llamadas.claves = claves;
              return Promise.resolve(resultado);
            },
          };
        },
      };
    },
  } as unknown as TypedSupabaseClient;
  return { client, llamadas };
}

describe('getAjustesDePrestamo', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reads the three keys from system_settings', async () => {
    const { client, llamadas } = clienteFalso({ data: [{ key: 'loan_cutoff_day', value: 20 }], error: null });
    expect(await getAjustesDePrestamo(client)).toEqual({ ...DEFECTO, diaDeCorte: 20 });
    expect(llamadas).toEqual({
      tabla: 'system_settings',
      claves: ['loan_full_rate_day_limit', 'loan_cutoff_day', 'loan_extended_term_enabled'],
    });
  });

  it('fails instead of using the defaults when the query fails, so no plan is saved with the wrong days', async () => {
    const { client } = clienteFalso({ data: null, error: { message: 'boom' } });
    await expect(getAjustesDePrestamo(client)).rejects.toThrow('No se pudieron leer los ajustes de préstamo');
  });
});

describe('interest rules with the loan settings (RN-4.20, RN-4.21)', () => {
  const ajustes = { diaLimiteTasaCompleta: 10, diaDeCorte: 20, plazoHastaPeriodoSiguiente: false };

  it('reglasDeInteresDelPrestamo takes the configured days', () => {
    expect(reglasDeInteresDelPrestamo(0.02, ajustes)).toEqual({
      ok: true,
      value: { tasaEnPuntosBasicos: 200, diaLimiteTasaCompleta: 10, diaDeCorte: 20 },
    });
  });

  it('reglasDeInteresDesdeAjuste takes the configured days', () => {
    expect(reglasDeInteresDesdeAjuste(0.02, ajustes)).toEqual({
      tasaEnPuntosBasicos: 200,
      diaLimiteTasaCompleta: 10,
      diaDeCorte: 20,
    });
  });
});

describe('buildPaymentPlan with the loan settings (RN-4.20, RN-4.21, RN-4.3)', () => {
  const base = { requestedAmount: 1_000_000, rate: 0.02 };

  it('RN-4.21: with the cut-off day at 20, a disbursement on 22 March starts in April at full rate', () => {
    const r = buildPaymentPlan({
      ...base,
      disbursedOn: fecha('2026-03-22'),
      ajustes: { ...DEFECTO, diaDeCorte: 20 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value[0].due_date).toBe('2026-04-01');
      expect(r.value[0].estimated_interest).toBe(20_000);
    }
  });

  it('RN-4.20: with the day limit at 10, a disbursement on 12 March pays half rate in March', () => {
    const r = buildPaymentPlan({ ...base, disbursedOn: fecha('2026-03-12'), ajustes: { ...DEFECTO, diaLimiteTasaCompleta: 10 } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value[0].estimated_interest).toBe(10_000);
  });

  it('RN-4.3: with the extended term enabled, the term runs until December of the next period', () => {
    const r = buildPaymentPlan({ ...base, disbursedOn: fecha('2026-10-05'), ajustes: { ...DEFECTO, plazoHastaPeriodoSiguiente: true } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.at(-1)?.due_date).toBe('2027-12-01');
  });

  it('keeps the defaults when no settings are given (December of the period, day 25)', () => {
    const r = buildPaymentPlan({ ...base, disbursedOn: fecha('2026-10-05') });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.at(-1)?.due_date).toBe('2026-12-01');
  });
});

describe('interest owed with the loan settings (RN-4.20, RN-4.21)', () => {
  const base = { requestedAmount: 1_000_000, rate: 0.02, items: [] };

  it('calcAccruedInterest: with the day limit at 10, a disbursement on 12 March owes 10.000 for March', () => {
    expect(
      calcAccruedInterest({ ...base, disbursedAt: '2026-03-12', today: fecha('2026-04-05'), ajustes: { ...DEFECTO, diaLimiteTasaCompleta: 10 } }),
    ).toEqual({ ok: true, value: 10_000 });
  });

  it('summarizeActiveLoanDebt: with the cut-off day at 20, a disbursement on 22 March counts from April', () => {
    const r = summarizeActiveLoanDebt({
      ...base,
      disbursedAt: '2026-03-22',
      today: fecha('2026-04-10'),
      ajustes: { ...DEFECTO, diaDeCorte: 20 },
    });
    expect(r).toEqual({
      ok: true,
      value: { outstandingCapital: 1_000_000, interestOwed: 0, monthsOverdue: 0, nextDueMonth: '2026-04-01' },
    });
  });
});
