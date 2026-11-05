import { describe, it, expect } from 'vitest';
import { crearFecha, type FechaISO } from '@/shared/domain/fechas';
import { calcAccruedInterest, buildPaymentPlan, type LoanInterestItem } from '@/lib/loans';
import { AJUSTES_DE_PRESTAMO_POR_DEFECTO, ajustesDelPrestamo, type AjustesDePrestamo } from '@/lib/loan-settings';
import { getLoanInterestOwed } from '@/lib/data/loans';

function fecha(texto: string): FechaISO {
  const r = crearFecha(texto);
  if (!r.ok) throw new Error(`Invalid test date: ${texto}`);
  return r.value;
}

// Settings changed after the loan was disbursed: the limit went from 15 to 25.
const AJUSTES_ACTUALES: AjustesDePrestamo = { diaLimiteTasaCompleta: 25, diaDeCorte: 28, plazoHastaPeriodoSiguiente: true };

// RN-4.21b example: disbursed on day 20 with the limit at 15 and the March
// half rate (10.000 on 1.000.000) already paid.
const PRESTAMO = { disbursed_at: '2026-03-20', full_rate_day_limit: 15, cutoff_day: 25 };
const PAGO_DE_MARZO: LoanInterestItem[] = [{ concept: 'pago_intereses', target_month: '2026-03-01', amount: 10_000 }];

describe('ajustesDelPrestamo (RN-4.21b)', () => {
  it('a disbursed loan uses the days stored on it, not the current settings', () => {
    expect(ajustesDelPrestamo(PRESTAMO, AJUSTES_ACTUALES)).toEqual({
      ok: true,
      value: { diaLimiteTasaCompleta: 15, diaDeCorte: 25, plazoHastaPeriodoSiguiente: true },
    });
  });

  it('RN-4.21b example: the limit later changes to 25 and no 10.000 appear as pending', () => {
    const ajustes = ajustesDelPrestamo(PRESTAMO, AJUSTES_ACTUALES);
    if (!ajustes.ok) throw new Error(ajustes.error.mensaje);
    const r = calcAccruedInterest({
      requestedAmount: 1_000_000,
      rate: 0.02,
      disbursedAt: PRESTAMO.disbursed_at,
      items: PAGO_DE_MARZO,
      today: fecha('2026-04-05'),
      ajustes: ajustes.value,
    });
    expect(r).toEqual({ ok: true, value: 0 });
  });

  it('a request that is not disbursed yet uses the current settings (plan preview)', () => {
    const solicitud = { disbursed_at: null, full_rate_day_limit: null, cutoff_day: null };
    const ajustes = ajustesDelPrestamo(solicitud, AJUSTES_ACTUALES);
    expect(ajustes).toEqual({ ok: true, value: AJUSTES_ACTUALES });
    if (!ajustes.ok) return;
    // Requested on day 20 with the limit at 25: full rate in the first month.
    const plan = buildPaymentPlan({
      requestedAmount: 1_000_000,
      rate: 0.02,
      disbursedOn: fecha('2026-03-20'),
      months: 1,
      requesting: true,
      ajustes: ajustes.value,
    });
    expect(plan.ok && plan.value[0]).toMatchObject({ due_date: '2026-03-01', estimated_interest: 20_000 });
  });

  it('a disbursed loan without its stored days is a data error, not a silent fallback', () => {
    for (const prestamo of [
      { disbursed_at: '2026-03-20', full_rate_day_limit: null, cutoff_day: 25 },
      { disbursed_at: '2026-03-20', full_rate_day_limit: 15, cutoff_day: null },
      { disbursed_at: '2026-03-20' },
    ]) {
      const r = ajustesDelPrestamo(prestamo, AJUSTES_ACTUALES);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.codigo).toBe('dias_del_prestamo_faltantes');
    }
  });

  it('a disbursed loan with inconsistent stored days is rejected', () => {
    const r = ajustesDelPrestamo({ disbursed_at: '2026-03-20', full_rate_day_limit: 25, cutoff_day: 20 }, AJUSTES_DE_PRESTAMO_POR_DEFECTO);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.codigo).toBe('dias_de_prestamo_inconsistentes');
  });
});

// A fake client: every query chain resolves to the rows given for its table.
function clienteFalso(tablas: Record<string, { data: unknown; error: unknown }>) {
  const columnas: Record<string, string> = {};
  const client = {
    from(tabla: string) {
      const resultado = tablas[tabla] ?? { data: [], error: null };
      const lista = { data: Array.isArray(resultado.data) ? resultado.data : [resultado.data], error: resultado.error };
      const builder: Record<string, unknown> = {
        select(cols: string) {
          columnas[tabla] = cols;
          return builder;
        },
        maybeSingle: () => Promise.resolve(resultado),
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(lista).then(resolve, reject),
      };
      for (const m of ['eq', 'in', 'not', 'order', 'range']) builder[m] = () => builder;
      return builder;
    },
  };
  return { client: client as unknown as Parameters<typeof getLoanInterestOwed>[0], columnas };
}

describe('getLoanInterestOwed (RN-4.21b)', () => {
  const ajustesGuardados = [
    { key: 'loan_full_rate_day_limit', value: 25 },
    { key: 'loan_cutoff_day', value: 28 },
  ];
  const pagos = [{ id: 'i1', loan_id: 'p1', concept: 'pago_intereses', target_month: '2026-03-01', amount: 10_000 }];

  it('computes the disbursed loan with its own stored days even after the settings changed', async () => {
    const { client, columnas } = clienteFalso({
      loans: { data: { id: 'p1', requested_amount: 1_000_000, interest_rate: 0.02, ...PRESTAMO }, error: null },
      receipt_items: { data: pagos, error: null },
      system_settings: { data: ajustesGuardados, error: null },
    });
    expect(await getLoanInterestOwed(client, 'p1', fecha('2026-04-05'))).toBe(0);
    expect(columnas.loans).toContain('full_rate_day_limit');
    expect(columnas.loans).toContain('cutoff_day');
  });

  it('fails when the disbursed loan has no stored days', async () => {
    const { client } = clienteFalso({
      loans: {
        data: { id: 'p1', requested_amount: 1_000_000, interest_rate: 0.02, disbursed_at: '2026-03-20', full_rate_day_limit: null, cutoff_day: null },
        error: null,
      },
      receipt_items: { data: pagos, error: null },
      system_settings: { data: ajustesGuardados, error: null },
    });
    await expect(getLoanInterestOwed(client, 'p1', fecha('2026-04-05'))).rejects.toThrow('día límite de media tasa');
  });
});
