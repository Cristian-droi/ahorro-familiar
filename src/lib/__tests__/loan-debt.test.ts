import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { crearFecha, type FechaISO } from '@/shared/domain/fechas';
import { summarizeActiveLoanDebt, type LoanInterestItem } from '@/lib/loans';
import {
  getLoanInterestItems,
  getLoanInterestOwed,
  getAllActiveLoansDebt,
  getMyActiveLoansDebt,
  LOAN_INTEREST_ITEMS_PAGE_SIZE,
} from '@/lib/data/loans';

function fecha(texto: string): FechaISO {
  const r = crearFecha(texto);
  if (!r.ok) throw new Error(`Invalid test date: ${texto}`);
  return r.value;
}

describe('summarizeActiveLoanDebt (interest from interesesAdeudados)', () => {
  const base = { requestedAmount: 1_000_000, rate: 0.02, items: [] as LoanInterestItem[] };

  it('RN-4.22b: without payments only finished months are owed, the current month is not', () => {
    const r = summarizeActiveLoanDebt({ ...base, disbursedAt: '2026-01-10', today: fecha('2026-04-10') });
    expect(r).toEqual({
      ok: true,
      value: { outstandingCapital: 1_000_000, interestOwed: 60_000, monthsOverdue: 3, nextDueMonth: '2026-03-01' },
    });
  });

  it('RN-4.18 and RN-4.25: capital paid mid-way lowers the next months and interest paid is subtracted', () => {
    const items: LoanInterestItem[] = [
      { concept: 'pago_capital', target_month: '2026-02-01', amount: 400_000 },
      { concept: 'pago_intereses', target_month: '2026-02-01', amount: 30_000 },
    ];
    // Jan 20.000 + Feb 20.000 + Mar 12.000 = 52.000 accrued, 30.000 paid.
    const r = summarizeActiveLoanDebt({ ...base, items, disbursedAt: '2026-01-10', today: fecha('2026-04-10') });
    expect(r).toEqual({
      ok: true,
      value: { outstandingCapital: 600_000, interestOwed: 22_000, monthsOverdue: 3, nextDueMonth: '2026-03-01' },
    });
  });

  it('RN-4.20: a disbursement on day 20 charges half the rate in its first month', () => {
    const r = summarizeActiveLoanDebt({ ...base, disbursedAt: '2026-03-20', today: fecha('2026-05-02') });
    expect(r.ok && r.value.interestOwed).toBe(30_000);
  });

  it('RN-4.21: a disbursement on day 28 charges nothing that month', () => {
    const r = summarizeActiveLoanDebt({ ...base, disbursedAt: '2026-03-28', today: fecha('2026-05-02') });
    expect(r.ok && r.value.interestOwed).toBe(20_000);
  });

  it('RN-4.21: after day 25 the loan counts from the next month for overdue months and the next due month', () => {
    const r = summarizeActiveLoanDebt({ ...base, disbursedAt: '2026-03-28', today: fecha('2026-05-02') });
    expect(r.ok && r.value).toMatchObject({ monthsOverdue: 1, nextDueMonth: '2026-04-01' });
    const enAbril = summarizeActiveLoanDebt({ ...base, disbursedAt: '2026-03-28', today: fecha('2026-04-10') });
    expect(enAbril.ok && enAbril.value).toMatchObject({ monthsOverdue: 0, nextDueMonth: '2026-04-01' });
  });

  it('in the disbursement month the next due month is that same month and nothing is overdue', () => {
    const r = summarizeActiveLoanDebt({ ...base, disbursedAt: '2026-03-10', today: fecha('2026-03-20') });
    expect(r).toEqual({
      ok: true,
      value: { outstandingCapital: 1_000_000, interestOwed: 0, monthsOverdue: 0, nextDueMonth: '2026-03-01' },
    });
  });

  it('capital paid for the current month already lowers the outstanding capital', () => {
    const items: LoanInterestItem[] = [{ concept: 'pago_capital', target_month: '2026-04-01', amount: 100_000 }];
    const r = summarizeActiveLoanDebt({ ...base, items, disbursedAt: '2026-01-10', today: fecha('2026-04-10') });
    expect(r.ok && r.value.outstandingCapital).toBe(900_000);
    expect(r.ok && r.value.interestOwed).toBe(60_000);
  });

  it('returns the domain error for an invalid rate', () => {
    const r = summarizeActiveLoanDebt({ ...base, rate: null, disbursedAt: '2026-01-10', today: fecha('2026-04-10') });
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A small fake Supabase client: it applies eq / in / not-is-null filters,
// order and range to in-memory rows, so the readers' queries are exercised.
// A filter on `receipts.status` reads the joined receipt of each item.
// ---------------------------------------------------------------------------
type Fila = Record<string, unknown>;

function leer(fila: Fila, columna: string): unknown {
  return columna.split('.').reduce<unknown>((v, k) => (v as Fila | null)?.[k], fila);
}

function fakeClient(tablas: Record<string, Fila[]>, userId: string | null = 'user-1') {
  const consultas: { table: string; range?: [number, number] }[] = [];
  const client = {
    auth: {
      async getUser() {
        return { data: { user: userId ? { id: userId } : null }, error: null };
      },
    },
    from(table: string) {
      let filas = [...(tablas[table] ?? [])];
      const consulta: { table: string; range?: [number, number] } = { table };
      consultas.push(consulta);
      const builder = {
        select() {
          return builder;
        },
        eq(columna: string, valor: unknown) {
          filas = filas.filter((f) => leer(f, columna) === valor);
          return builder;
        },
        in(columna: string, valores: unknown[]) {
          filas = filas.filter((f) => valores.includes(leer(f, columna)));
          return builder;
        },
        not(columna: string, op: string, valor: unknown) {
          if (op !== 'is' || valor !== null) throw new Error('fake: unsupported not()');
          filas = filas.filter((f) => leer(f, columna) != null);
          return builder;
        },
        order(columna: string) {
          filas = [...filas].sort((a, b) => String(leer(a, columna)).localeCompare(String(leer(b, columna))));
          return builder;
        },
        range(desde: number, hasta: number) {
          consulta.range = [desde, hasta];
          filas = filas.slice(desde, hasta + 1);
          return builder;
        },
        async maybeSingle() {
          return { data: filas[0] ?? null, error: null };
        },
        then(resolve: (r: { data: Fila[]; error: null }) => void) {
          resolve({ data: filas, error: null });
        },
      };
      return builder;
    },
  };
  return { supabase: client as unknown as SupabaseClient<Database>, consultas };
}

const item = (id: string, loan_id: string | null, concept: string, amount: number, status: string, target_month = '2026-02-01') => ({
  id,
  loan_id,
  concept,
  target_month,
  amount,
  receipts: { status },
});

describe('getLoanInterestItems (R3-005)', () => {
  it('maps only approved capital and interest items, and loans without items get an empty list', async () => {
    const { supabase } = fakeClient({
      receipt_items: [
        item('a', 'loan-1', 'pago_capital', 100_000, 'approved'),
        item('b', 'loan-1', 'pago_intereses', 20_000, 'approved'),
        item('c', 'loan-1', 'pago_capital', 50_000, 'pending'),
        item('d', 'loan-1', 'pago_intereses', 9_000, 'rejected'),
        item('e', 'loan-1', 'acciones', 70_000, 'approved'),
        item('f', 'loan-3', 'pago_capital', 1_000, 'approved'),
      ],
    });
    const r = await getLoanInterestItems(supabase, ['loan-1', 'loan-2']);
    expect([...r.keys()]).toEqual(['loan-1', 'loan-2']);
    expect(r.get('loan-1')).toEqual([
      { concept: 'pago_capital', target_month: '2026-02-01', amount: 100_000 },
      { concept: 'pago_intereses', target_month: '2026-02-01', amount: 20_000 },
    ]);
    expect(r.get('loan-2')).toEqual([]);
  });

  it('without loans it does not query', async () => {
    const { supabase, consultas } = fakeClient({});
    expect((await getLoanInterestItems(supabase, [])).size).toBe(0);
    expect(consultas).toHaveLength(0);
  });

  it('R3-004: reads every page instead of stopping at the first one', async () => {
    const total = LOAN_INTEREST_ITEMS_PAGE_SIZE + 5;
    const filas = Array.from({ length: total }, (_, i) =>
      item(`i${String(i).padStart(6, '0')}`, 'loan-1', 'pago_intereses', 1, 'approved'),
    );
    const { supabase, consultas } = fakeClient({ receipt_items: filas });
    const r = await getLoanInterestItems(supabase, ['loan-1']);
    expect(r.get('loan-1')).toHaveLength(total);
    expect(consultas.map((c) => c.range)).toEqual([
      [0, LOAN_INTEREST_ITEMS_PAGE_SIZE - 1],
      [LOAN_INTEREST_ITEMS_PAGE_SIZE, 2 * LOAN_INTEREST_ITEMS_PAGE_SIZE - 1],
    ]);
  });
});

describe('getLoanInterestOwed (receipt approval, RN-4.24)', () => {
  const loan = { id: 'loan-1', requested_amount: 1_000_000, interest_rate: 0.02, disbursed_at: '2026-01-10T15:00:00+00:00', full_rate_day_limit: 15, cutoff_day: 25 };

  it('counts approved items only, so the pending receipt being approved is not counted', async () => {
    const { supabase } = fakeClient({
      loans: [loan],
      receipt_items: [
        item('a', 'loan-1', 'pago_intereses', 30_000, 'approved'),
        item('b', 'loan-1', 'pago_intereses', 30_000, 'pending'),
      ],
    });
    expect(await getLoanInterestOwed(supabase, 'loan-1', fecha('2026-04-10'))).toBe(30_000);
  });

  it('a loan that does not exist or is not disbursed owes 0', async () => {
    const { supabase } = fakeClient({ loans: [{ ...loan, id: 'loan-2', disbursed_at: null }] });
    expect(await getLoanInterestOwed(supabase, 'loan-1', fecha('2026-04-10'))).toBe(0);
    expect(await getLoanInterestOwed(supabase, 'loan-2', fecha('2026-04-10'))).toBe(0);
  });

  it('fails loudly when the domain rejects the data', async () => {
    const { supabase } = fakeClient({ loans: [{ ...loan, interest_rate: null }] });
    await expect(getLoanInterestOwed(supabase, 'loan-1', fecha('2026-04-10'))).rejects.toThrow();
  });
});

describe('getMyActiveLoansDebt (replaces get_user_active_loans_debt)', () => {
  const loans = [
    { id: 'loan-1', user_id: 'user-1', status: 'active', loan_number: 7, disbursement_number: 'D-7', requested_amount: 1_000_000, interest_rate: 0.02, disbursed_at: '2026-01-10T15:00:00+00:00', full_rate_day_limit: 15, cutoff_day: 25 },
    { id: 'loan-2', user_id: 'user-1', status: 'paid', loan_number: 8, disbursement_number: 'D-8', requested_amount: 500_000, interest_rate: 0.02, disbursed_at: '2026-01-10T15:00:00+00:00', full_rate_day_limit: 15, cutoff_day: 25 },
    { id: 'loan-3', user_id: 'user-2', status: 'active', loan_number: 9, disbursement_number: 'D-9', requested_amount: 500_000, interest_rate: 0.02, disbursed_at: '2026-01-10T15:00:00+00:00', full_rate_day_limit: 15, cutoff_day: 25 },
    { id: 'loan-4', user_id: 'user-1', status: 'active', loan_number: 10, disbursement_number: null, requested_amount: 500_000, interest_rate: 0.02, disbursed_at: null },
  ];

  it('returns the same shape for my active disbursed loans, with interest from the domain', async () => {
    const { supabase } = fakeClient({
      loans,
      receipt_items: [
        item('a', 'loan-1', 'pago_capital', 400_000, 'approved'),
        item('b', 'loan-1', 'pago_intereses', 30_000, 'approved'),
        item('c', 'loan-1', 'pago_intereses', 99_000, 'pending'),
      ],
    });
    expect(await getMyActiveLoansDebt(supabase, fecha('2026-04-10'))).toEqual([
      {
        loan_id: 'loan-1',
        loan_number: 7,
        disbursement_number: 'D-7',
        requested_amount: 1_000_000,
        outstanding_capital: 600_000,
        interest_rate: 0.02,
        disbursed_at: '2026-01-10T15:00:00+00:00',
        interest_owed: 22_000,
        months_overdue: 3,
        next_due_month: '2026-03-01',
      },
    ]);
  });

  it('without a signed-in user it returns an empty list', async () => {
    const { supabase } = fakeClient({ loans }, null);
    expect(await getMyActiveLoansDebt(supabase, fecha('2026-04-10'))).toEqual([]);
  });
});

describe('getAllActiveLoansDebt (admin summary)', () => {
  const loans = [
    { id: 'loan-1', user_id: 'user-1', status: 'active', loan_number: 7, disbursement_number: 'D-7', requested_amount: 1_000_000, interest_rate: 0.02, disbursed_at: '2026-01-10T15:00:00+00:00', full_rate_day_limit: 15, cutoff_day: 25 },
    { id: 'loan-2', user_id: 'user-1', status: 'paid', loan_number: 8, disbursement_number: 'D-8', requested_amount: 500_000, interest_rate: 0.02, disbursed_at: '2026-01-10T15:00:00+00:00', full_rate_day_limit: 15, cutoff_day: 25 },
    { id: 'loan-3', user_id: 'user-2', status: 'active', loan_number: 9, disbursement_number: 'D-9', requested_amount: 500_000, interest_rate: 0.02, disbursed_at: '2026-01-10T15:00:00+00:00', full_rate_day_limit: 15, cutoff_day: 25 },
  ];

  it('RN-4.22: returns every active loan of every shareholder with its owner and the interest owed from the domain', async () => {
    const { supabase } = fakeClient({
      loans,
      receipt_items: [
        item('a', 'loan-1', 'pago_capital', 400_000, 'approved'),
        item('b', 'loan-1', 'pago_intereses', 30_000, 'approved'),
      ],
    });
    const deudas = await getAllActiveLoansDebt(supabase, fecha('2026-04-10'));
    expect(deudas.map((d) => [d.user_id, d.loan_id, d.interest_owed, d.outstanding_capital])).toEqual([
      ['user-1', 'loan-1', 22_000, 600_000],
      // Jan, Feb and Mar at 2% of 500.000.
      ['user-2', 'loan-3', 30_000, 500_000],
    ]);
  });
});
