import { describe, it, expect } from 'vitest';
import {
  agreedPlanFromRows,
  buildPaymentPlan,
  calcAccruedInterest,
} from '@/lib/loans';
import { crearFecha, type FechaISO } from '@/shared/domain/fechas';

describe('Financial Calculations', () => {
  describe('buildPaymentPlan (adapter over planDePagos)', () => {
    const fecha = (texto: string): FechaISO => {
      const r = crearFecha(texto);
      if (!r.ok) throw new Error(`Invalid test date: ${texto}`);
      return r.value;
    };
    const rows = (r: ReturnType<typeof buildPaymentPlan>) => {
      if (!r.ok) throw new Error(r.error.mensaje);
      return r.value;
    };

    it('builds the plan until December with the stored fractional rate (RN-4.3, RN-4.18)', () => {
      const plan = rows(buildPaymentPlan({ requestedAmount: 1_000_000, rate: 0.02, disbursedOn: fecha('2026-03-10') }));

      expect(plan).toHaveLength(10);
      expect(plan[0]).toEqual({
        month_number: 1,
        due_date: '2026-03-01',
        capital_amount: 100_000,
        estimated_interest: 20_000,
        estimated_balance_after: 900_000,
      });
      expect(plan[9]).toMatchObject({ due_date: '2026-12-01', capital_amount: 100_000, estimated_balance_after: 0 });
    });

    it('keeps installment-number overrides, relative to the applied month (RN-4.26)', () => {
      const plan = rows(
        buildPaymentPlan({
          requestedAmount: 1_000_000,
          rate: 0.02,
          disbursedOn: fecha('2026-03-10'),
          capitalOverrides: { 5: 200_000 },
        }),
      );
      expect(plan[4]).toMatchObject({ due_date: '2026-07-01', capital_amount: 200_000 });
      expect(plan[5].capital_amount).toBe(80_000);
    });

    it('charges half rate in the first month after day 15 (RN-4.20)', () => {
      const plan = rows(buildPaymentPlan({ requestedAmount: 1_000_000, rate: 0.02, disbursedOn: fecha('2026-05-20') }));
      expect(plan[0].estimated_interest).toBe(10_000);
      expect(plan[1].estimated_interest).toBe(17_500); // 8 months from May: 2% of 875.000
    });

    it('moves a disbursement after day 25 to the next month (RN-4.15, RN-4.21)', () => {
      const plan = rows(buildPaymentPlan({ requestedAmount: 1_000_000, rate: 0.02, disbursedOn: fecha('2026-03-28') }));
      expect(plan[0]).toMatchObject({ month_number: 1, due_date: '2026-04-01', estimated_interest: 20_000 });
      expect(plan).toHaveLength(9);
    });

    it('returns the domain error for an invalid override', () => {
      const r = buildPaymentPlan({
        requestedAmount: 1_000_000,
        rate: 0.02,
        disbursedOn: fecha('2026-03-10'),
        capitalOverrides: { 2: -5 },
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.codigo).toBe('capital_invalido');
    });

    it('uses the term chosen in months from the applied month (RN-4.3)', () => {
      const plan = rows(buildPaymentPlan({ requestedAmount: 1_000_000, rate: 0.02, disbursedOn: fecha('2026-03-28'), months: 3 }));
      expect(plan.map((r) => r.due_date)).toEqual(['2026-04-01', '2026-05-01', '2026-06-01']);
    });

    it('rejects a term in months beyond December (RN-4.3)', () => {
      const r = buildPaymentPlan({ requestedAmount: 1_000_000, rate: 0.02, disbursedOn: fecha('2026-03-10'), months: 13 });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.codigo).toBe('plazo_mayor_al_maximo');
        expect(r.error.mensaje).toBe('El plazo puede ir como máximo hasta diciembre de 2026 (10 meses).');
      }
    });

    it.each([0, -1, 2.5])('rejects a term of %s months', (months) => {
      const r = buildPaymentPlan({ requestedAmount: 1_000_000, rate: 0.02, disbursedOn: fecha('2026-03-10'), months });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.codigo).toBe('plazo_invalido');
    });

    it('uses the chosen last calendar month and calendar-month overrides (RN-4.3b)', () => {
      const plan = rows(
        buildPaymentPlan({
          requestedAmount: 1_000_000,
          rate: 0.02,
          disbursedOn: fecha('2026-02-02'),
          lastMonth: fecha('2026-06-01'),
          capitalOverrides: { '2026-06-01': 1_000_000 },
        }),
      );
      expect(plan.map((r) => r.capital_amount)).toEqual([0, 0, 0, 0, 1_000_000]);
      expect(plan.map((r) => r.estimated_interest)).toEqual([20_000, 20_000, 20_000, 20_000, 20_000]);
    });

    it.each([0, -3])('rejects the installment number %s', (n) => {
      const r = buildPaymentPlan({
        requestedAmount: 1_000_000,
        rate: 0.02,
        disbursedOn: fecha('2026-03-10'),
        capitalOverrides: { [n]: 100_000 },
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.codigo).toBe('cuota_invalida');
    });

    it("fails when the loan's own rate is missing instead of using 2% (RN-4.18)", () => {
      for (const rate of [null, undefined, 'abc']) {
        const r = buildPaymentPlan({ requestedAmount: 1_000_000, rate, disbursedOn: fecha('2026-03-10') });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.codigo).toBe('tasa_invalida');
      }
    });
  });

  describe('agreedPlanFromRows (RN-4.3, RN-4.3b)', () => {
    it('reads the last month of the term and the capital by calendar month', () => {
      const r = agreedPlanFromRows([
        { due_date: '2026-03-01', capital_amount: 0 },
        { due_date: '2026-06-01', capital_amount: '1000000' },
        { due_date: '2026-04-01', capital_amount: 0 },
      ]);
      expect(r).toEqual({
        ok: true,
        value: {
          lastMonth: '2026-06-01',
          capitalOverrides: { '2026-03-01': 0, '2026-04-01': 0, '2026-06-01': 1_000_000 },
        },
      });
    });

    it('returns no term and no capital for an empty plan', () => {
      expect(agreedPlanFromRows([])).toEqual({ ok: true, value: { lastMonth: undefined, capitalOverrides: {} } });
    });

    it('rejects a stored row with an invalid date', () => {
      const r = agreedPlanFromRows([{ due_date: 'junio', capital_amount: 0 }]);
      expect(r.ok).toBe(false);
    });
  });

  describe('disbursement rebuild (RN-4.3b)', () => {
    const fecha = (texto: string): FechaISO => {
      const r = crearFecha(texto);
      if (!r.ok) throw new Error(`Invalid test date: ${texto}`);
      return r.value;
    };

    it('a plan agreed in March and disbursed in April keeps the months and moves March capital to the first month (April)', () => {
      const draft = buildPaymentPlan({ requestedAmount: 1_000_000, rate: 0.02, disbursedOn: fecha('2026-03-10') });
      if (!draft.ok) throw new Error(draft.error.mensaje);
      const agreed = agreedPlanFromRows(draft.value);
      if (!agreed.ok) throw new Error(agreed.error.mensaje);

      const real = buildPaymentPlan({
        requestedAmount: 1_000_000,
        rate: 0.02,
        disbursedOn: fecha('2026-04-10'),
        lastMonth: agreed.value.lastMonth,
        capitalOverrides: agreed.value.capitalOverrides,
      });
      if (!real.ok) throw new Error(real.error.mensaje);
      expect(real.value).toHaveLength(9);
      expect(real.value[0]).toMatchObject({ due_date: '2026-04-01', capital_amount: 200_000, estimated_balance_after: 800_000 });
      expect(real.value.slice(1).every((r) => r.capital_amount === 100_000)).toBe(true);
      expect(real.value[8]).toMatchObject({ due_date: '2026-12-01', capital_amount: 100_000, estimated_balance_after: 0 });
    });
  });

  describe('calcAccruedInterest (adapter over interesesAdeudados)', () => {
    it('RN-4.22: three months unpaid on 1.000.000 at 2% owe 60.000', () => {
      const r = calcAccruedInterest({
        requestedAmount: 1_000_000,
        rate: 0.02,
        disbursedAt: '2026-01-10T17:00:00+00:00',
        items: [],
        today: '2026-04-10' as FechaISO,
      });
      expect(r).toEqual({ ok: true, value: 60_000 });
    });
  });
});
