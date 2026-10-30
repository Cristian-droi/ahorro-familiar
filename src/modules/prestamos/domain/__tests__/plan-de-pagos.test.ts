import { describe, it, expect } from 'vitest';
import { crearFecha, type FechaISO } from '@/shared/domain/fechas';
import type { ReglasDeInteres } from '@/modules/prestamos/domain/intereses';
import {
  planDePagos,
  type CuotaDelPlan,
  planAcordadoDesdeCuotas,
  validarPlanSolicitado,
} from '@/modules/prestamos/domain/plan-de-pagos';

// Default parameters from docs/reglas-negocio.md, section 10: 2% monthly
// (200 basis points), full rate until day 15, applied-month cut-off day 25.
const REGLAS: ReglasDeInteres = { tasaEnPuntosBasicos: 200, diaLimiteTasaCompleta: 15, diaDeCorte: 25 };

function fecha(texto: string): FechaISO {
  const r = crearFecha(texto);
  if (!r.ok) throw new Error(`Invalid test date: ${texto}`);
  return r.value;
}

interface Opciones {
  monto?: number;
  hastaPeriodoSiguiente?: boolean;
  mesFinal?: string;
  capitalPorMes?: Record<string, number>;
}

function intentar(fechaDesembolso: string, opciones: Opciones = {}) {
  return planDePagos({
    monto: opciones.monto ?? 1_000_000,
    fechaDesembolso: fecha(fechaDesembolso),
    reglas: REGLAS,
    hastaPeriodoSiguiente: opciones.hastaPeriodoSiguiente ?? false,
    mesFinal: opciones.mesFinal === undefined ? undefined : fecha(opciones.mesFinal),
    capitalPorMes: opciones.capitalPorMes,
  });
}

function plan(fechaDesembolso: string, opciones: Opciones = {}): CuotaDelPlan[] {
  const r = intentar(fechaDesembolso, opciones);
  if (!r.ok) throw new Error(r.error.mensaje);
  return r.value;
}

const sumaCapital = (cuotas: CuotaDelPlan[]) => cuotas.reduce((s, c) => s + c.capital, 0);

describe('planDePagos: maximum term when none is chosen (RN-4.3, RN-4.15)', () => {
  it('rule example: a January loan has up to 12 months', () => {
    const cuotas = plan('2026-01-02');
    expect(cuotas).toHaveLength(12);
    expect(cuotas[0].mes).toBe('2026-01-01');
    expect(cuotas[11].mes).toBe('2026-12-01');
  });

  it('rule example: an October loan has up to 3 months', () => {
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

describe('planDePagos: term chosen by the shareholder (RN-4.3)', () => {
  it('ends the plan in the chosen month', () => {
    const cuotas = plan('2026-03-10', { mesFinal: '2026-06-01' });
    expect(cuotas.map((c) => c.mes)).toEqual(['2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01']);
    expect(cuotas.map((c) => c.capital)).toEqual([250_000, 250_000, 250_000, 250_000]);
    expect(cuotas[3].saldoDespues).toBe(0);
  });

  it('accepts any day of the chosen month', () => {
    expect(plan('2026-03-10', { mesFinal: '2026-06-17' })).toHaveLength(4);
  });

  it('accepts a single-month term in the applied month', () => {
    const cuotas = plan('2026-03-10', { mesFinal: '2026-03-01' });
    expect(cuotas).toEqual([{ numero: 1, mes: '2026-03-01', capital: 1_000_000, interes: 20_000, saldoDespues: 0 }]);
  });

  it('accepts December, the maximum', () => {
    expect(plan('2026-03-10', { mesFinal: '2026-12-01' })).toHaveLength(10);
  });

  it('rejects a term beyond December of the period', () => {
    const r = intentar('2026-03-10', { mesFinal: '2027-01-01' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.codigo).toBe('plazo_mayor_al_maximo');
      expect(r.error.mensaje).toBe('El plazo puede ir como máximo hasta diciembre de 2026 (10 meses).');
    }
  });

  it('allows December of the next period when the admin enables it', () => {
    expect(plan('2026-03-10', { mesFinal: '2027-06-01', hastaPeriodoSiguiente: true })).toHaveLength(16);
    const r = intentar('2026-03-10', { mesFinal: '2028-01-01', hastaPeriodoSiguiente: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.mensaje).toBe('El plazo puede ir como máximo hasta diciembre de 2027 (22 meses).');
  });

  it('RN-4.3b: a term that ends before the applied month becomes the applied month with all the capital', () => {
    const cuotas = plan('2026-03-28', { mesFinal: '2026-03-01' });
    expect(cuotas).toEqual([{ numero: 1, mes: '2026-04-01', capital: 1_000_000, interes: 20_000, saldoDespues: 0 }]);
  });

  it('RN-4.3b: a whole agreed term already behind leaves all the agreed capital in the first month', () => {
    // Agreed in March: 500.000 in March and 500.000 in April. Disbursed in May.
    const cuotas = plan('2026-05-10', {
      mesFinal: '2026-04-01',
      capitalPorMes: { '2026-03-01': 500_000, '2026-04-01': 500_000 },
    });
    expect(cuotas).toEqual([{ numero: 1, mes: '2026-05-01', capital: 1_000_000, interes: 20_000, saldoDespues: 0 }]);
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

  it('an edited month keeps the earlier ones and splits the rest among the later ones', () => {
    // 10 months from March: July (installment 5) edited to 200.000.
    const cuotas = plan('2026-03-10', { capitalPorMes: { '2026-07-01': 200_000 } });
    expect(cuotas.slice(0, 4).map((c) => c.capital)).toEqual([100_000, 100_000, 100_000, 100_000]);
    expect(cuotas[4].capital).toBe(200_000);
    expect(cuotas.slice(5).map((c) => c.capital)).toEqual([80_000, 80_000, 80_000, 80_000, 80_000]);
    expect(sumaCapital(cuotas)).toBe(1_000_000);
  });

  it('when the earlier installments would exceed the amount, they drop to zero', () => {
    const cuotas = plan('2026-03-10', { capitalPorMes: { '2026-12-01': 1_000_000 } });
    expect(cuotas.slice(0, 9).every((c) => c.capital === 0)).toBe(true);
    expect(cuotas[9].capital).toBe(1_000_000);
    expect(cuotas[0].interes).toBe(20_000);
    expect(cuotas[9].interes).toBe(20_000);
  });

  it('when every later installment is edited, the last one absorbs the difference', () => {
    const cuotas = plan('2026-10-05', {
      capitalPorMes: { '2026-10-01': 100_000, '2026-11-01': 100_000, '2026-12-01': 100_000 },
    });
    expect(cuotas.map((c) => c.capital)).toEqual([100_000, 100_000, 800_000]);
  });

  it('never charges more capital than the outstanding balance', () => {
    const cuotas = plan('2026-10-05', { capitalPorMes: { '2026-10-01': 2_000_000 } });
    expect(cuotas.map((c) => c.capital)).toEqual([1_000_000, 0, 0]);
    expect(cuotas.map((c) => c.saldoDespues)).toEqual([0, 0, 0]);
  });
});

describe('planDePagos: agreed plan by calendar month (RN-4.3b)', () => {
  it('rule example: requested in February, all paid in June: capital in June, interest February to June', () => {
    const cuotas = plan('2026-02-02', { mesFinal: '2026-06-01', capitalPorMes: { '2026-06-01': 1_000_000 } });
    expect(cuotas.map((c) => c.mes)).toEqual(['2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01']);
    expect(cuotas.map((c) => c.capital)).toEqual([0, 0, 0, 0, 1_000_000]);
    expect(cuotas.map((c) => c.interes)).toEqual([20_000, 20_000, 20_000, 20_000, 20_000]);
    expect(cuotas[4].saldoDespues).toBe(0);
  });

  it('RN-4.3b: a disbursement moved from March to April sends the capital agreed for March to the first month', () => {
    // Agreed in March: 100.000 per month from March to December.
    const acordado: Record<string, number> = {};
    for (let m = 3; m <= 12; m++) acordado[`2026-${String(m).padStart(2, '0')}-01`] = 100_000;

    const cuotas = plan('2026-04-10', { mesFinal: '2026-12-01', capitalPorMes: acordado });
    expect(cuotas).toHaveLength(9);
    expect(cuotas[0]).toMatchObject({ mes: '2026-04-01', capital: 200_000, saldoDespues: 800_000 });
    expect(cuotas.slice(1).every((c) => c.capital === 100_000)).toBe(true);
    expect(cuotas[8]).toMatchObject({ mes: '2026-12-01', capital: 100_000, saldoDespues: 0 });
    expect(sumaCapital(cuotas)).toBe(1_000_000);
  });

  it('keys the agreed capital by month, not by installment number, when the start moves', () => {
    // Agreed in February: everything in June. Disbursed in March, June is still the month.
    const cuotas = plan('2026-03-10', {
      mesFinal: '2026-06-01',
      capitalPorMes: {
        '2026-02-01': 0,
        '2026-03-01': 0,
        '2026-04-01': 0,
        '2026-05-01': 0,
        '2026-06-01': 1_000_000,
      },
    });
    expect(cuotas.map((c) => c.mes)).toEqual(['2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01']);
    expect(cuotas.map((c) => c.capital)).toEqual([0, 0, 0, 1_000_000]);
  });

  it('RN-4.3b: adds past-month capital to the first month even when the first month was not edited', () => {
    const cuotas = plan('2026-10-05', { capitalPorMes: { '2026-09-01': 300_000 } });
    expect(cuotas.map((c) => c.capital)).toEqual([533_333, 233_333, 233_334]);
    expect(sumaCapital(cuotas)).toBe(1_000_000);
  });

  it('accepts any day of the month as the key', () => {
    const cuotas = plan('2026-10-05', { capitalPorMes: { '2026-12-15': 1_000_000 } });
    expect(cuotas.map((c) => c.capital)).toEqual([0, 0, 1_000_000]);
  });

  it('rejects capital agreed for a month after the term', () => {
    const r = intentar('2026-03-10', { mesFinal: '2026-06-01', capitalPorMes: { '2026-07-01': 100_000 } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.codigo).toBe('capital_fuera_del_plazo');
      expect(r.error.mensaje).toBe('Hay capital asignado a un mes después del último mes del plazo.');
    }
  });

  it('rejects a key that is not a date', () => {
    const r = intentar('2026-03-10', { capitalPorMes: { '5': 100_000 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.codigo).toBe('mes_invalido');
  });
});

describe('validarPlanSolicitado: no past months when requesting (RN-4.3b)', () => {
  const solicitar = (fechaSolicitud: string, opciones: { mesFinal?: string; capitalPorMes?: Record<string, number> }) =>
    validarPlanSolicitado({
      fechaSolicitud: fecha(fechaSolicitud),
      diaDeCorte: REGLAS.diaDeCorte,
      mesFinal: opciones.mesFinal === undefined ? undefined : fecha(opciones.mesFinal),
      capitalPorMes: opciones.capitalPorMes,
    });

  it('RN-4.3b: accepts a plan from the current month to the limit', () => {
    expect(solicitar('2026-10-30', { mesFinal: '2026-12-01', capitalPorMes: { '2026-11-01': 500_000 } }).ok).toBe(true);
  });

  it('RN-4.3b: accepts no term and no capital', () => {
    expect(solicitar('2026-10-05', {}).ok).toBe(true);
  });

  it('RN-4.3b: rejects capital in a month before the current month', () => {
    const r = solicitar('2026-10-05', { capitalPorMes: { '2026-09-01': 300_000 } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.codigo).toBe('cuota_en_mes_pasado');
      expect(r.error.mensaje).toBe('No se pueden poner cuotas en meses pasados: el plan va desde el mes actual hasta el límite.');
    }
  });

  it('RN-4.3b and RN-4.15: after the cut-off day the current month is the next one', () => {
    // Requested on 28 October: the applied month is November, so October is past.
    const r = solicitar('2026-10-28', { capitalPorMes: { '2026-10-01': 100_000 } });
    expect(!r.ok && r.error.codigo).toBe('cuota_en_mes_pasado');
  });

  it('RN-4.3b: a zero capital in a past month is not an installment and is accepted', () => {
    expect(solicitar('2026-10-05', { capitalPorMes: { '2026-09-01': 0 } }).ok).toBe(true);
  });

  it('RN-4.3b: rejects a term that ends before the current month', () => {
    const r = solicitar('2026-10-05', { mesFinal: '2026-09-01' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.codigo).toBe('plazo_antes_del_mes_aplicado');
      expect(r.error.mensaje).toBe('El plazo no puede terminar antes del mes actual del préstamo.');
    }
  });

  it('rejects a key that is not a date', () => {
    const r = solicitar('2026-10-05', { capitalPorMes: { junio: 100_000 } });
    expect(!r.ok && r.error.codigo).toBe('mes_invalido');
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
    const r = planDePagos({ ...base, monto: 1_000_000, capitalPorMes: { '2026-04-01': valor } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.codigo).toBe('capital_invalido');
  });
});

describe('planAcordadoDesdeCuotas (RN-4.3b)', () => {
  it('RN-4.3b: rebuilds the agreed last month and the capital by calendar month', () => {
    const r = planAcordadoDesdeCuotas([
      { mes: '2026-03-01' as FechaISO, capital: 0 },
      { mes: '2026-06-01' as FechaISO, capital: 1000000 },
    ]);
    expect(r).toEqual({
      ok: true,
      value: { mesFinal: '2026-06-01', capitalPorMes: { '2026-03-01': 0, '2026-06-01': 1000000 } },
    });
  });

  it('RN-4.3b: rejects a month that appears twice instead of adding it up', () => {
    const r = planAcordadoDesdeCuotas([
      { mes: '2026-03-01' as FechaISO, capital: 100 },
      { mes: '2026-03-01' as FechaISO, capital: 200 },
    ]);
    expect(!r.ok && r.error.codigo).toBe('mes_duplicado');
  });

  it('RN-4.3b: rejects a negative or fractional capital', () => {
    const r = planAcordadoDesdeCuotas([{ mes: '2026-03-01' as FechaISO, capital: -1 }]);
    expect(!r.ok && r.error.codigo).toBe('capital_invalido');
  });

  it('RN-4.3b: an empty plan has no last month', () => {
    expect(planAcordadoDesdeCuotas([])).toEqual({ ok: true, value: { mesFinal: undefined, capitalPorMes: {} } });
  });
});
