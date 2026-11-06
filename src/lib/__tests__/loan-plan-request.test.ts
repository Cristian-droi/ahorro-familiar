import { describe, it, expect } from 'vitest';
import { crearFecha, type FechaISO } from '@/shared/domain/fechas';
import { buildPaymentPlan } from '@/lib/loans';

function fecha(texto: string): FechaISO {
  const r = crearFecha(texto);
  if (!r.ok) throw new Error(`Invalid test date: ${texto}`);
  return r.value;
}

const base = { requestedAmount: 1_000_000, rate: 0.02, disbursedOn: fecha('2026-10-05') };

describe('buildPaymentPlan when requesting (RN-4.3b)', () => {
  it('RN-4.3b: rejects capital in a past calendar month when requesting', () => {
    const r = buildPaymentPlan({ ...base, requesting: true, capitalOverrides: { '2026-09-01': 300_000 } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.codigo).toBe('cuota_en_mes_pasado');
      expect(r.error.mensaje).toBe('No se pueden poner cuotas en meses pasados: el plan va desde el mes actual hasta el límite.');
    }
  });

  it('RN-4.3b: rejects a stored last month before the current month when requesting', () => {
    const r = buildPaymentPlan({ ...base, requesting: true, lastMonth: fecha('2026-09-01') });
    expect(!r.ok && r.error.codigo).toBe('plazo_antes_del_mes_aplicado');
  });

  it('RN-4.3b: installment numbers start at the current month, so they are accepted', () => {
    const r = buildPaymentPlan({ ...base, requesting: true, months: 3, capitalOverrides: { '1': 500_000 } });
    expect(r.ok && r.value.map((row) => row.capital_amount)).toEqual([500_000, 250_000, 250_000]);
  });

  it('RN-4.3b: without requesting (disbursement) past-month capital goes to the first month', () => {
    const r = buildPaymentPlan({ ...base, capitalOverrides: { '2026-09-01': 300_000 } });
    expect(r.ok && r.value.map((row) => row.capital_amount)).toEqual([533_333, 233_333, 233_334]);
  });
});
