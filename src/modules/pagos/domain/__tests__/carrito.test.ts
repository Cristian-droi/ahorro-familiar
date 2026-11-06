import { describe, it, expect } from 'vitest';
import { totalDelCarrito } from '@/modules/pagos/domain/carrito';

const reglas = { minAccionesPorMes: 1, maxAccionesPorMes: 10 };

describe('totalDelCarrito (RN-4.29b)', () => {
  it('charges each chosen month its shares plus that month fine only', () => {
    // Three months behind, pays only the oldest one with 2 shares of 25.000.
    const r = totalDelCarrito({
      meses: [{ mes: '2026-08-01', acciones: 2, valorAccion: 25000, multa: 15000 }],
      prestamos: [],
      reglas,
    });
    expect(r).toEqual({
      ok: true,
      value: {
        meses: [{ mes: '2026-08-01', acciones: 2, valorAcciones: 50000, multa: 15000, subtotal: 65000 }],
        prestamos: [],
        total: 65000,
      },
    });
  });

  it('applies a loan payment to interest first, then capital', () => {
    const r = totalDelCarrito({
      meses: [],
      prestamos: [{ id: 'A', interesesPendientes: 20000, saldoCapital: 1000000, pago: 120000 }],
      reglas,
    });
    expect(r).toEqual({
      ok: true,
      value: {
        meses: [],
        prestamos: [
          {
            id: 'A',
            aIntereses: 20000,
            aCapital: 100000,
            interesesRestantes: 0,
            saldoRestante: 900000,
            pagado: false,
          },
        ],
        total: 120000,
      },
    });
  });

  it('adds shares and loans into one total to send with the receipt', () => {
    const r = totalDelCarrito({
      meses: [
        { mes: '2026-09-01', acciones: 1, valorAccion: 25000, multa: 15000 },
        { mes: '2026-10-01', acciones: 4, valorAccion: 25000, multa: 0 },
      ],
      prestamos: [{ id: 'A', interesesPendientes: 20000, saldoCapital: 1000000, pago: 20000 }],
      reglas,
    });
    expect(r.ok && r.value.total).toBe(160000);
  });

  it('rejects a capital payment above the balance (RN-4.29)', () => {
    const r = totalDelCarrito({
      meses: [],
      prestamos: [{ id: 'A', interesesPendientes: 0, saldoCapital: 1200000, pago: 1224389 }],
      reglas,
    });
    expect(!r.ok && r.error.codigo).toBe('abono_mayor_al_saldo');
  });

  it('rejects a share count outside RN-3.1', () => {
    const r = totalDelCarrito({
      meses: [{ mes: '2026-10-01', acciones: 11, valorAccion: 25000, multa: 0 }],
      prestamos: [],
      reglas,
    });
    expect(r).toEqual({
      ok: false,
      error: { codigo: 'cantidad_fuera_de_rango', mensaje: 'Puedes comprar entre 1 y 10 acciones por mes.' },
    });
  });

  it.each([
    [{ meses: [], prestamos: [] }, 'carrito_vacio'],
    [
      {
        meses: [
          { mes: '2026-10-01', acciones: 1, valorAccion: 25000, multa: 0 },
          { mes: '2026-10-01', acciones: 1, valorAccion: 25000, multa: 0 },
        ],
        prestamos: [],
      },
      'mes_repetido',
    ],
    [
      {
        meses: [],
        prestamos: [
          { id: 'A', interesesPendientes: 0, saldoCapital: 1000, pago: 100 },
          { id: 'A', interesesPendientes: 0, saldoCapital: 1000, pago: 100 },
        ],
      },
      'prestamo_repetido',
    ],
    [{ meses: [{ mes: '2026-10-01', acciones: 1, valorAccion: 0, multa: 0 }], prestamos: [] }, 'valor_invalido'],
    [{ meses: [{ mes: '2026-10-01', acciones: 1, valorAccion: 25000, multa: -1 }], prestamos: [] }, 'valor_invalido'],
  ])('returns an error for %o', (carrito, codigo) => {
    const r = totalDelCarrito({ ...carrito, reglas });
    expect(!r.ok && r.error.codigo).toBe(codigo);
  });
});
