import { describe, it, expect } from 'vitest';
import { crearFecha, type FechaISO } from '@/shared/domain/fechas';
import type { ReglasDeInteres } from '@/modules/prestamos/domain/intereses';
import { planDePagos, type CuotaDelPlan } from '@/modules/prestamos/domain/plan-de-pagos';

// Default parameters from docs/reglas-negocio.md, section 10: 2% monthly
// (200 basis points), full rate until day 15, applied-month cut-off day 25.
const REGLAS: ReglasDeInteres = { tasaEnPuntosBasicos: 200, diaLimiteTasaCompleta: 15, diaDeCorte: 25 };

function fecha(texto: string): FechaISO {
  const r = crearFecha(texto);
  if (!r.ok) throw new Error(`Invalid test date: ${texto}`);
  return r.value;
}

function plan(
  fechaDesembolso: string,
  opciones: { monto?: number; hastaPeriodoSiguiente?: boolean; capitalPorCuota?: Record<number, number> } = {},
): CuotaDelPlan[] {
  const r = planDePagos({
    monto: opciones.monto ?? 1_000_000,
    fechaDesembolso: fecha(fechaDesembolso),
    reglas: REGLAS,
    hastaPeriodoSiguiente: opciones.hastaPeriodoSiguiente ?? false,
    capitalPorCuota: opciones.capitalPorCuota,
  });
  if (!r.ok) throw new Error(r.error.mensaje);
  return r.value;
}

const sumaCapital = (cuotas: CuotaDelPlan[]) => cuotas.reduce((s, c) => s + c.capital, 0);

describe('planDePagos: term (RN-4.3, RN-4.15)', () => {
  it('rule example: a January loan has 12 months', () => {
    const cuotas = plan('2026-01-02');
    expect(cuotas).toHaveLength(12);
    expect(cuotas[0].mes).toBe('2026-01-01');
    expect(cuotas[11].mes).toBe('2026-12-01');
  });

  it('rule example: an October loan has 3 months', () => {
    const cuotas = plan('2026-10-05');
    expect(cuotas.map((c) => c.mes)).toEqual(['2026-10-01', '2026-11-01', '2026-12-01']);
  });

  it('a disbursement after day 25 starts in the next month (RN-4.15)', () => {
    const cuotas = plan('2026-03-28');
    expect(cuotas).toHaveLength(9);
    expect(cuotas[0].mes).toBe('2026-04-01');
  });

  it('a disbursement after 25 December belongs to the next period: 12 months', () => {
    const cuotas = plan('2026-12-28');
    expect(cuotas).toHaveLength(12);
    expect(cuotas[0].mes).toBe('2027-01-01');
    expect(cuotas[11].mes).toBe('2027-12-01');
  });

  it('the extended term runs until December of the next period', () => {
    const cuotas = plan('2026-10-05', { hastaPeriodoSiguiente: true });
    expect(cuotas).toHaveLength(15);
    expect(cuotas[14].mes).toBe('2027-12-01');
  });

  it('numbers the installments from 1', () => {
    expect(plan('2026-10-05').map((c) => c.numero)).toEqual([1, 2, 3]);
  });
});

describe('planDePagos: interest (RN-4.18, RN-4.20, RN-4.21, RN-4.22)', () => {
  it('rule example: disbursed on 10 March, March interest on 1.000.000 is 20.000', () => {
    expect(plan('2026-03-10')[0].interes).toBe(20_000);
  });

  it('rule example: disbursed on 20 March, March interest is 10.000 (half rate)', () => {
    const cuotas = plan('2026-03-20');
    expect(cuotas[0].mes).toBe('2026-03-01');
    expect(cuotas[0].interes).toBe(10_000);
  });

  it('rule example: disbursed on 28 March, March has no interest and April is 20.000', () => {
    const cuotas = plan('2026-03-28');
    expect(cuotas.some((c) => c.mes === '2026-03-01')).toBe(false);
    expect(cuotas[0]).toMatchObject({ mes: '2026-04-01', interes: 20_000 });
  });

  it('charges the rate on the projected outstanding balance of each month', () => {
    // 10 months from March: 100.000 of capital per month.
    const cuotas = plan('2026-03-10');
    expect(cuotas[1].interes).toBe(18_000); // 2% of 900.000
    expect(cuotas[9].interes).toBe(2_000); // 2% of 100.000
  });

  it('half rate applies only to the first month', () => {
    const cuotas = plan('2026-03-20');
    expect(cuotas[1].interes).toBe(18_000);
  });
});

describe('planDePagos: capital distribution (RN-4.26)', () => {
  it('spreads the capital in equal parts and leaves the balance at zero', () => {
    const cuotas = plan('2026-03-10');
    expect(cuotas.every((c) => c.capital === 100_000)).toBe(true);
    expect(cuotas[9].saldoDespues).toBe(0);
    expect(cuotas[0].saldoDespues).toBe(900_000);
  });

  it('the last installment absorbs the remainder of an inexact division, in whole pesos', () => {
    const cuotas = plan('2026-10-05');
    expect(cuotas.map((c) => c.capital)).toEqual([333_333, 333_333, 333_334]);
    expect(sumaCapital(cuotas)).toBe(1_000_000);
  });

  it('an edited installment keeps the earlier ones and splits the rest among the later ones', () => {
    // 10 months from March: edit installment 5 to 200.000.
    const cuotas = plan('2026-03-10', { capitalPorCuota: { 5: 200_000 } });
    expect(cuotas.slice(0, 4).map((c) => c.capital)).toEqual([100_000, 100_000, 100_000, 100_000]);
    expect(cuotas[4].capital).toBe(200_000);
    expect(cuotas.slice(5).map((c) => c.capital)).toEqual([80_000, 80_000, 80_000, 80_000, 80_000]);
    expect(sumaCapital(cuotas)).toBe(1_000_000);
  });

  it('when the earlier installments would exceed the amount, they drop to zero', () => {
    const cuotas = plan('2026-03-10', { capitalPorCuota: { 10: 1_000_000 } });
    expect(cuotas.slice(0, 9).every((c) => c.capital === 0)).toBe(true);
    expect(cuotas[9].capital).toBe(1_000_000);
    expect(cuotas[0].interes).toBe(20_000);
    expect(cuotas[9].interes).toBe(20_000);
  });

  it('when every later installment is edited, the last one absorbs the difference', () => {
    const cuotas = plan('2026-10-05', { capitalPorCuota: { 1: 100_000, 2: 100_000, 3: 100_000 } });
    expect(cuotas.map((c) => c.capital)).toEqual([100_000, 100_000, 800_000]);
  });

  it('never charges more capital than the outstanding balance', () => {
    const cuotas = plan('2026-10-05', { capitalPorCuota: { 1: 2_000_000 } });
    expect(cuotas.map((c) => c.capital)).toEqual([1_000_000, 0, 0]);
    expect(cuotas.map((c) => c.saldoDespues)).toEqual([0, 0, 0]);
  });
});

describe('planDePagos: invalid input', () => {
  const base = { fechaDesembolso: fecha('2026-03-10'), reglas: REGLAS, hastaPeriodoSiguiente: false };

  it.each([0, -1, 1000.5])('rejects the amount %s', (monto) => {
    const r = planDePagos({ ...base, monto });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.codigo).toBe('monto_invalido');
  });

  it.each([-1, 100.5])('rejects the edited capital %s', (valor) => {
    const r = planDePagos({ ...base, monto: 1_000_000, capitalPorCuota: { 2: valor } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.codigo).toBe('capital_invalido');
  });
});
