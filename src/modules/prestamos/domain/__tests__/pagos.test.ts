import { describe, it, expect } from 'vitest';
import { aplicarPago, estaPagado, sumarAbonosPorPrestamo, validarAbonoACapital } from '@/modules/prestamos/domain/pagos';

describe('sumarAbonosPorPrestamo (RN-4.29, RN-4.27)', () => {
  it('RN-4.29: adds the capital lines of each loan separately', () => {
    const r = sumarAbonosPorPrestamo([
      { prestamoId: 'a', monto: 600000 },
      { prestamoId: 'b', monto: 50000 },
      { prestamoId: 'a', monto: 400000 },
    ]);
    expect(r).toEqual(new Map([['a', 1000000], ['b', 50000]]));
  });

  it('returns an empty map without lines', () => {
    expect(sumarAbonosPorPrestamo([])).toEqual(new Map());
  });
});

describe('validarAbonoACapital (RN-4.29)', () => {
  it('RN-4.29: rejects the Sheet case, 1.224.389 against a balance of 1.200.000, and shows the maximum', () => {
    const r = validarAbonoACapital({ saldoCapital: 1200000, abonosPendientes: 0, abono: 1224389 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.codigo).toBe('abono_mayor_al_saldo');
    expect(r.error.mensaje).toContain('$1.200.000');
  });

  it('RN-4.29: accepts a payment equal to the balance', () => {
    expect(validarAbonoACapital({ saldoCapital: 1200000, abonosPendientes: 0, abono: 1200000 })).toEqual({ ok: true, value: 0 });
  });

  it('RN-4.29: payments waiting for approval use up the balance', () => {
    const r = validarAbonoACapital({ saldoCapital: 1000000, abonosPendientes: 700000, abono: 300001 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.mensaje).toContain('$300.000');
    expect(validarAbonoACapital({ saldoCapital: 1000000, abonosPendientes: 700000, abono: 300000 })).toEqual({ ok: true, value: 0 });
  });

  it('RN-4.29: rejects any capital payment on a loan with no balance', () => {
    expect(validarAbonoACapital({ saldoCapital: 0, abonosPendientes: 0, abono: 1 }).ok).toBe(false);
  });

  it('rejects invalid values', () => {
    expect(validarAbonoACapital({ saldoCapital: 1000, abonosPendientes: 0, abono: 0 }).ok).toBe(false);
    expect(validarAbonoACapital({ saldoCapital: -1, abonosPendientes: 0, abono: 1 }).ok).toBe(false);
    expect(validarAbonoACapital({ saldoCapital: 1000, abonosPendientes: -1, abono: 1 }).ok).toBe(false);
  });
});

describe('aplicarPago (RN-4.24, RN-4.25, RN-4.28, RN-4.29)', () => {
  it('matches the RN-4.25 example: owes 60.000 in interest and pays 40.000', () => {
    const r = aplicarPago({ interesesPendientes: 60000, saldoCapital: 1000000, pago: 40000 });
    expect(r).toEqual({
      ok: true,
      value: { aIntereses: 40000, aCapital: 0, interesesRestantes: 20000, saldoRestante: 1000000, pagado: false },
    });
  });

  it('pays interest first and the rest goes to capital', () => {
    const r = aplicarPago({ interesesPendientes: 60000, saldoCapital: 1000000, pago: 260000 });
    expect(r).toEqual({
      ok: true,
      value: { aIntereses: 60000, aCapital: 200000, interesesRestantes: 0, saldoRestante: 800000, pagado: false },
    });
  });

  it('goes straight to capital when there is no pending interest', () => {
    const r = aplicarPago({ interesesPendientes: 0, saldoCapital: 1000000, pago: 300000 });
    expect(r.ok && r.value.aCapital).toBe(300000);
  });

  it('marks the loan as paid when capital and interest reach zero', () => {
    const r = aplicarPago({ interesesPendientes: 24000, saldoCapital: 1200000, pago: 1224000 });
    expect(r.ok && r.value).toEqual({
      aIntereses: 24000,
      aCapital: 1200000,
      interesesRestantes: 0,
      saldoRestante: 0,
      pagado: true,
    });
  });

  it('rejects a capital payment above the outstanding balance and shows the maximum', () => {
    // RN-4.29: the Sheet case, 1.224.389 against a balance of 1.200.000.
    const r = aplicarPago({ interesesPendientes: 0, saldoCapital: 1200000, pago: 1224389 });
    expect(r).toEqual({
      ok: false,
      error: {
        codigo: 'abono_mayor_al_saldo',
        mensaje: 'El abono a capital no puede superar el saldo pendiente del préstamo (1.200.000).',
      },
    });
  });

  it.each([
    [{ interesesPendientes: 0, saldoCapital: 1000, pago: 0 }, 'pago_invalido'],
    [{ interesesPendientes: 0, saldoCapital: 1000, pago: 10.5 }, 'pago_invalido'],
    [{ interesesPendientes: -1, saldoCapital: 1000, pago: 100 }, 'valor_invalido'],
    [{ interesesPendientes: 0, saldoCapital: -1, pago: 100 }, 'valor_invalido'],
  ])('returns an error for %o', (params, codigo) => {
    const r = aplicarPago(params);
    expect(!r.ok && r.error.codigo).toBe(codigo);
  });
});

describe('estaPagado (RN-4.28)', () => {
  it.each([
    [0, 0, true],
    [0, 1, false],
    [1, 0, false],
  ])('balance %i and interest %i → %s', (saldoCapital, interesesPendientes, esperado) => {
    expect(estaPagado({ saldoCapital, interesesPendientes })).toBe(esperado);
  });
});
