import { describe, it, expect } from 'vitest';
import { crearFecha, type FechaISO } from '@/shared/domain/fechas';
import { interesDelMes, interesesDelPeriodo, type ReglasDeInteres } from '@/modules/prestamos/domain/intereses';

// Default parameters from docs/reglas-negocio.md, section 10: 2% monthly
// (200 basis points), full rate until day 15, applied-month cut-off day 25.
const REGLAS: ReglasDeInteres = { tasaEnPuntosBasicos: 200, diaLimiteTasaCompleta: 15, diaDeCorte: 25 };

function fecha(texto: string): FechaISO {
  const r = crearFecha(texto);
  if (!r.ok) throw new Error(`Invalid test date: ${texto}`);
  return r.value;
}

function interes(fechaDesembolso: string, mes: string, saldoCapital = 1000000): number {
  const r = interesDelMes({ saldoCapital, mes: fecha(mes), fechaDesembolso: fecha(fechaDesembolso), reglas: REGLAS });
  if (!r.ok) throw new Error(r.error.mensaje);
  return r.value;
}

describe('interesDelMes (RN-4.18, RN-4.20)', () => {
  it('rule example: disbursed on 10 March, March interest on 1.000.000 is 20.000', () => {
    expect(interes('2026-03-10', '2026-03-01')).toBe(20000);
  });

  it('rule example: disbursed on 20 March, March interest is 10.000 (half rate)', () => {
    expect(interes('2026-03-20', '2026-03-01')).toBe(10000);
  });

  it.each([
    ['2026-03-15', 20000],
    ['2026-03-16', 10000],
    ['2026-03-25', 10000],
  ])('a disbursement on %s owes %i in its first month', (desembolso, esperado) => {
    expect(interes(desembolso, '2026-03-01')).toBe(esperado);
  });

  it('charges the full rate from the second month on', () => {
    expect(interes('2026-03-20', '2026-04-01')).toBe(20000);
  });

  it('charges on the real outstanding balance, not the agreed plan', () => {
    expect(interes('2026-03-10', '2026-06-01', 400000)).toBe(8000);
  });

  it('owes nothing on a paid-off loan', () => {
    expect(interes('2026-03-10', '2026-06-01', 0)).toBe(0);
  });

  it('owes nothing before the disbursement month', () => {
    expect(interes('2026-03-10', '2026-02-01')).toBe(0);
  });

  it('rounds to the nearest peso', () => {
    // 333.333 × 2% = 6.666,66 and × 1% = 3.333,33.
    expect(interes('2026-03-10', '2026-03-01', 333333)).toBe(6667);
    expect(interes('2026-03-20', '2026-03-01', 333333)).toBe(3333);
  });

  it('uses the configured rate and day limit', () => {
    const r = interesDelMes({
      saldoCapital: 1000000,
      mes: fecha('2026-03-01'),
      fechaDesembolso: fecha('2026-03-12'),
      reglas: { tasaEnPuntosBasicos: 150, diaLimiteTasaCompleta: 10, diaDeCorte: 25 },
    });
    expect(r).toEqual({ ok: true, value: 7500 });
  });

  it.each([-1, 1000.5])('rejects an invalid balance %s', (saldoCapital) => {
    const r = interesDelMes({
      saldoCapital,
      mes: fecha('2026-03-01'),
      fechaDesembolso: fecha('2026-03-10'),
      reglas: REGLAS,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.codigo).toBe('saldo_invalido');
  });
});

// 🟡 RN-4.21 is pending validation with the manager (docs/reglas-negocio.md).
// If the manager decides otherwise, only this block and `tasaDelMes` change.
describe('🟡 interesDelMes after the cut-off day (RN-4.21, pending validation)', () => {
  it('rule example: disbursed on 28 March, March owes nothing', () => {
    expect(interes('2026-03-28', '2026-03-01')).toBe(0);
  });

  it('rule example: disbursed on 28 March, April owes the full rate (20.000)', () => {
    expect(interes('2026-03-28', '2026-04-01')).toBe(20000);
  });
});

describe('interesesDelPeriodo (RN-4.19, RN-4.22)', () => {
  it('rule example: three unpaid months on 1.000.000 → 60.000, with no interest on interest', () => {
    const r = interesesDelPeriodo({
      fechaDesembolso: fecha('2026-03-10'),
      meses: [
        { mes: fecha('2026-03-01'), saldoCapital: 1000000 },
        { mes: fecha('2026-04-01'), saldoCapital: 1000000 },
        { mes: fecha('2026-05-01'), saldoCapital: 1000000 },
      ],
      reglas: REGLAS,
    });
    expect(r).toEqual({
      ok: true,
      value: {
        porMes: [
          { mes: '2026-03-01', interes: 20000 },
          { mes: '2026-04-01', interes: 20000 },
          { mes: '2026-05-01', interes: 20000 },
        ],
        total: 60000,
      },
    });
  });

  it('follows the real balance month by month after capital payments', () => {
    const r = interesesDelPeriodo({
      fechaDesembolso: fecha('2026-03-20'),
      meses: [
        { mes: fecha('2026-03-01'), saldoCapital: 1000000 },
        { mes: fecha('2026-04-01'), saldoCapital: 600000 },
        { mes: fecha('2026-05-01'), saldoCapital: 0 },
      ],
      reglas: REGLAS,
    });
    expect(r.ok && r.value.total).toBe(22000);
  });

  it('rejects the whole period when one balance is invalid', () => {
    const r = interesesDelPeriodo({
      fechaDesembolso: fecha('2026-03-10'),
      meses: [
        { mes: fecha('2026-03-01'), saldoCapital: 1000000 },
        { mes: fecha('2026-04-01'), saldoCapital: -5 },
      ],
      reglas: REGLAS,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.codigo).toBe('saldo_invalido');
  });
});
