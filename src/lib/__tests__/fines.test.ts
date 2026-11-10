import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PURCHASE_RULES,
  computeFineDetail,
  computeFineForMonth,
  toReglasDeMulta,
} from '@/lib/fines';

// The legacy adapter must return the RN-3.4 numbers of the domain
// (docs/reglas-negocio.md): 500 a day from day 11 of each unpaid month,
// capped at 15.000.
const dia = (texto: string) => new Date(`${texto}T00:00:00Z`);

describe('toReglasDeMulta', () => {
  it('maps the stored purchase rules to the domain fine rules', () => {
    expect(toReglasDeMulta(DEFAULT_PURCHASE_RULES)).toEqual({
      diasDeGracia: 10,
      multaPorDia: 500,
      topeMensual: 15000,
    });
  });
});

describe('computeFineForMonth (RN-3.4)', () => {
  it('charges nothing for August during its grace days', () => {
    expect(computeFineForMonth('2026-08-01', dia('2026-08-10'), DEFAULT_PURCHASE_RULES)).toBe(0);
  });

  it('charges 500 for August on 2026-08-11', () => {
    expect(computeFineForMonth('2026-08-01', dia('2026-08-11'), DEFAULT_PURCHASE_RULES)).toBe(500);
  });

  it('keeps adding to August in September: 11.500 on 2026-09-02', () => {
    expect(computeFineForMonth('2026-08-01', dia('2026-09-02'), DEFAULT_PURCHASE_RULES)).toBe(11500);
  });

  it('caps August at 15.000 on 2026-09-20', () => {
    expect(computeFineForMonth('2026-08-01', dia('2026-09-20'), DEFAULT_PURCHASE_RULES)).toBe(15000);
  });

  it('charges 5.000 for September on 2026-09-20', () => {
    expect(computeFineForMonth('2026-09-01', dia('2026-09-20'), DEFAULT_PURCHASE_RULES)).toBe(5000);
  });
});

describe('computeFineDetail', () => {
  it('reports the charged days of an uncapped month', () => {
    expect(computeFineDetail('2026-09-01', dia('2026-09-20'), DEFAULT_PURCHASE_RULES)).toEqual({
      amount: 5000,
      daysLate: 10,
      chargedDays: 10,
      capped: false,
    });
  });

  it('reports the cap and the 30 charged days of a capped month', () => {
    expect(computeFineDetail('2026-08-01', dia('2026-09-20'), DEFAULT_PURCHASE_RULES)).toEqual({
      amount: 15000,
      daysLate: 41,
      chargedDays: 30,
      capped: true,
    });
  });

  it('returns zeros during the grace days', () => {
    expect(computeFineDetail('2026-08-01', dia('2026-08-05'), DEFAULT_PURCHASE_RULES)).toEqual({
      amount: 0,
      daysLate: 0,
      chargedDays: 0,
      capped: false,
    });
  });
});

describe('computeFineForMonth with the joining date (RN-3.6)', () => {
  it('RN-3.6: approved on 20 August, the August fine on 30 August is 5.000', () => {
    expect(computeFineForMonth('2026-08-01', dia('2026-08-30'), DEFAULT_PURCHASE_RULES, '2026-08-20')).toBe(5000);
    expect(computeFineDetail('2026-08-01', dia('2026-08-30'), DEFAULT_PURCHASE_RULES, '2026-08-20')).toMatchObject({
      amount: 5000,
      daysLate: 10,
    });
  });

  it('RN-3.6: a month before joining has no fine', () => {
    expect(computeFineForMonth('2026-07-01', dia('2026-09-20'), DEFAULT_PURCHASE_RULES, '2026-08-05')).toBe(0);
  });

  it('a null joining date keeps the previous fine', () => {
    expect(computeFineForMonth('2026-08-01', dia('2026-08-30'), DEFAULT_PURCHASE_RULES, null)).toBe(10000);
  });
});
