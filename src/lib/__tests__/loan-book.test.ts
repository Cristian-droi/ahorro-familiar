import { describe, it, expect } from 'vitest';
import { crearFecha, type FechaISO } from '@/shared/domain/fechas';
import { computeLoanBook, computeUnifiedLoanBook, type LoanBook, type PlanRow } from '@/lib/loans';

function fecha(texto: string): FechaISO {
  const r = crearFecha(texto);
  if (!r.ok) throw new Error(`Invalid test date: ${texto}`);
  return r.value;
}

// Stored rows of 1.000.000 at 2% disbursed on 10 March, 250.000 a month to June.
const PLAN: PlanRow[] = [
  { month_number: 1, due_date: '2026-03-01', capital_amount: 250_000, estimated_interest: 20_000, estimated_balance_after: 750_000 },
  { month_number: 2, due_date: '2026-04-01', capital_amount: 250_000, estimated_interest: 15_000, estimated_balance_after: 500_000 },
  { month_number: 3, due_date: '2026-05-01', capital_amount: 250_000, estimated_interest: 10_000, estimated_balance_after: 250_000 },
  { month_number: 4, due_date: '2026-06-01', capital_amount: 250_000, estimated_interest: 5_000, estimated_balance_after: 0 },
];

function book(params: { today: string; payments?: Parameters<typeof computeLoanBook>[0]['payments']; disbursedAt?: string | null; rate?: unknown }): LoanBook {
  const r = computeLoanBook({
    requestedAmount: 1_000_000,
    plan: PLAN,
    payments: params.payments ?? [],
    interestRate: params.rate ?? 0.02,
    disbursedAt: params.disbursedAt === undefined ? '2026-03-10T15:00:00+00:00' : params.disbursedAt,
    today: fecha(params.today),
  });
  if (!r.ok) throw new Error(r.error.mensaje);
  return r.value;
}

describe('computeLoanBook (adapter over libroDelPrestamo)', () => {
  it('RN-4.3b: keeps the legacy row shape with the agreed plan and the payments of each month', () => {
    const b = book({
      today: '2026-04-15',
      payments: [
        { target_month: '2026-03-01', concept: 'pago_capital', amount: 250_000 },
        { target_month: '2026-03-01', concept: 'pago_intereses', amount: 20_000 },
      ],
    });
    expect(b.months[0]).toEqual({
      month_number: 1,
      due_date: '2026-03-01',
      plan_capital: 250_000,
      plan_interest: 20_000,
      paid_capital: 250_000,
      paid_interest: 20_000,
      interest_debt: 0,
      capital_balance_after: 750_000,
      installment_value: 270_000,
      is_next_installment: false,
    });
    expect(b.summary).toEqual({
      requested_amount: 1_000_000,
      total_paid_capital: 250_000,
      total_paid_interest: 20_000,
      total_interest_debt: 0,
      overdue_interest_debt: 0,
      current_capital_balance: 750_000,
      next_installment_amount: 265_000,
      next_installment_month: '2026-04-01',
      total_plan_capital: 1_000_000,
      total_plan_interest: 50_000,
      total_installment_value: 1_050_000,
    });
  });

  it('RN-4.22b: the injected day decides which months are finished', () => {
    expect(book({ today: '2026-04-30' }).summary.overdue_interest_debt).toBe(20_000);
    expect(book({ today: '2026-05-01' }).summary.overdue_interest_debt).toBe(40_000);
  });

  it('RN-4.18: interest in arrears is on the real balance, not on the plan interest', () => {
    // No capital paid: April accrues 20.000 although the plan says 15.000.
    const b = book({ today: '2026-05-15' });
    expect(b.months.map((m) => m.interest_debt)).toEqual([20_000, 20_000, 0, 0]);
  });

  it('RN-4.29: rejects capital payments above the amount instead of clamping the balance at 0', () => {
    const r = computeLoanBook({
      requestedAmount: 1_000_000,
      plan: PLAN,
      payments: [{ target_month: '2026-03-01', concept: 'pago_capital', amount: 1_200_000 }],
      interestRate: 0.02,
      disbursedAt: '2026-03-10',
      today: fecha('2026-04-15'),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.codigo).toBe('abonos_mayores_al_monto');
  });

  it('RN-4.18: a disbursed loan with an invalid stored rate fails instead of using a default', () => {
    const r = computeLoanBook({
      requestedAmount: 1_000_000,
      plan: PLAN,
      payments: [],
      interestRate: 'abc',
      disbursedAt: '2026-03-10',
      today: fecha('2026-04-15'),
    });
    expect(r.ok).toBe(false);
  });

  it('a loan not disbursed yet shows its plan without interest in arrears', () => {
    const b = book({ today: '2026-08-15', disbursedAt: null, rate: null });
    expect(b.summary.overdue_interest_debt).toBe(0);
    expect(b.summary.next_installment_month).toBe('2026-03-01');
  });
});

describe('computeUnifiedLoanBook (adapter over libroUnificado)', () => {
  it('adds every loan month by month and reads the disbursement day in Bogota', () => {
    const a = book({ today: '2026-05-15' });
    // 1 April 02:00 UTC is still 31 March in Bogota.
    const b = book({ today: '2026-05-15', disbursedAt: '2026-04-01T02:00:00+00:00' });
    const r = computeUnifiedLoanBook([
      { requested: 1_000_000, book: a, disbursedAt: '2026-03-10T15:00:00+00:00' },
      { requested: 1_000_000, book: b, disbursedAt: '2026-04-01T02:00:00+00:00' },
    ]);
    if (!r.ok) throw new Error(r.error.mensaje);
    expect(r.value.rows.map((row) => [row.month_key, row.disbursed_this_month, row.installment_value])).toEqual([
      ['2026-03', 2_000_000, 540_000],
      ['2026-04', 0, 530_000],
      ['2026-05', 0, 520_000],
      ['2026-06', 0, 510_000],
    ]);
    expect(r.value.summary.total_requested).toBe(2_000_000);
    // A: March and April on 1.000.000 → 40.000. B: 31 March is after the
    // cut-off day, so only April → 20.000 (RN-4.21).
    expect(r.value.summary.overdue_interest_debt).toBe(60_000);
    expect(r.value.summary.total_installment_value).toBe(2_100_000);
    expect(r.value.summary.total_disbursed_in_rows).toBe(2_000_000);
  });
});
