// Applying a payment to loans (docs/reglas-negocio.md, section 4.6).

import { formatearPesos } from '@/shared/domain/dinero';
import { ok, err, type Result, type ErrorDeDominio } from '@/shared/domain/result';

function esPagoValido(valor: number): boolean {
  return Number.isInteger(valor) && valor > 0;
}

function esSaldoValido(valor: number): boolean {
  return Number.isInteger(valor) && valor >= 0;
}

const PAGO_INVALIDO: ErrorDeDominio = {
  codigo: 'pago_invalido',
  mensaje: 'El pago debe ser un número entero mayor que cero.',
};

const VALOR_INVALIDO: ErrorDeDominio = {
  codigo: 'valor_invalido',
  mensaje: 'El saldo y los intereses del préstamo deben ser números enteros no negativos.',
};

// RN-4.28: a loan is paid when its capital balance and its interest are zero.
export function estaPagado(params: { saldoCapital: number; interesesPendientes: number }): boolean {
  return params.saldoCapital === 0 && params.interesesPendientes === 0;
}

// RN-4.27 and RN-4.29: each loan is independent, so its lines add up on their own.
export function sumarAbonosPorPrestamo(
  lineas: { prestamoId: string; monto: number }[],
): Map<string, number> {
  const totales = new Map<string, number>();
  for (const { prestamoId, monto } of lineas) {
    totales.set(prestamoId, (totales.get(prestamoId) ?? 0) + monto);
  }
  return totales;
}

// RN-4.29: a capital payment never exceeds what is left of the balance once the
// payments waiting for approval are counted. Returns what would be left.
export function validarAbonoACapital(params: {
  saldoCapital: number;
  abonosPendientes: number;
  abono: number;
}): Result<number, ErrorDeDominio> {
  const { saldoCapital, abonosPendientes, abono } = params;
  if (!esPagoValido(abono)) return err(PAGO_INVALIDO);
  if (!esSaldoValido(saldoCapital) || !esSaldoValido(abonosPendientes)) return err(VALOR_INVALIDO);

  const disponible = Math.max(saldoCapital - abonosPendientes, 0);
  if (abono > disponible) {
    return err({
      codigo: 'abono_mayor_al_saldo',
      mensaje: `El abono a capital no puede superar el saldo pendiente del préstamo. Puedes abonar hasta $${formatearPesos(disponible)}.`,
    });
  }
  return ok(disponible - abono);
}

export interface PagoAplicado {
  aIntereses: number;
  aCapital: number;
  interesesRestantes: number;
  saldoRestante: number;
  pagado: boolean;
}

export function aplicarPago(params: {
  interesesPendientes: number;
  saldoCapital: number;
  pago: number;
}): Result<PagoAplicado, ErrorDeDominio> {
  const { interesesPendientes, saldoCapital, pago } = params;
  if (!esPagoValido(pago)) return err(PAGO_INVALIDO);
  if (!esSaldoValido(interesesPendientes) || !esSaldoValido(saldoCapital)) return err(VALOR_INVALIDO);

  // RN-4.24 and RN-4.25: interest first, partial interest payments allowed.
  const aIntereses = Math.min(pago, interesesPendientes);
  const aCapital = pago - aIntereses;

  // RN-4.29: the capital payment never exceeds the balance.
  if (aCapital > saldoCapital) {
    return err({
      codigo: 'abono_mayor_al_saldo',
      mensaje: `El abono a capital no puede superar el saldo pendiente del préstamo (${formatearPesos(saldoCapital)}).`,
    });
  }

  const interesesRestantes = interesesPendientes - aIntereses;
  const saldoRestante = saldoCapital - aCapital;
  return ok({
    aIntereses,
    aCapital,
    interesesRestantes,
    saldoRestante,
    pagado: estaPagado({ saldoCapital: saldoRestante, interesesPendientes: interesesRestantes }),
  });
}

// RN-4.29b: one loan line of the cart, where the shareholder chooses how much
// goes to interest and how much to capital. RN-4.25 allows partial interest;
// RN-4.24 accepts capital only once that loan's interest is paid in full;
// RN-4.29 caps capital at the balance.
export function validarPagoDelCarrito(params: {
  interesesPendientes: number;
  saldoCapital: number;
  aIntereses: number;
  aCapital: number;
}): Result<{ interesesRestantes: number; saldoRestante: number }, ErrorDeDominio> {
  const { interesesPendientes, saldoCapital, aIntereses, aCapital } = params;
  if (![interesesPendientes, saldoCapital, aIntereses, aCapital].every(esSaldoValido)) return err(VALOR_INVALIDO);
  if (aIntereses === 0 && aCapital === 0) {
    return err({ codigo: 'pago_vacio', mensaje: 'Indica cuánto pagas de intereses o de capital, o quita el préstamo del recibo.' });
  }
  if (aIntereses > interesesPendientes) {
    return err({
      codigo: 'intereses_mayores_a_lo_adeudado',
      mensaje: `El pago de intereses no puede superar lo adeudado (${formatearPesos(interesesPendientes)}).`,
    });
  }
  const interesesRestantes = interesesPendientes - aIntereses;
  if (aCapital > 0 && interesesRestantes > 0) {
    return err({
      codigo: 'intereses_primero',
      mensaje: `Para abonar a capital primero paga todos los intereses (${formatearPesos(interesesPendientes)}).`,
    });
  }
  if (aCapital > saldoCapital) {
    return err({
      codigo: 'abono_mayor_al_saldo',
      mensaje: `El abono a capital no puede superar el saldo pendiente del préstamo (${formatearPesos(saldoCapital)}).`,
    });
  }
  return ok({ interesesRestantes, saldoRestante: saldoCapital - aCapital });
}

// RN-4.25: interest the shareholder pays on one loan of the cart. Untouched
// (undefined) pays everything owed; a blank field (null) pays nothing.
export function pagoDeInteresesElegido(params: {
  interesesPendientes: number;
  ingresado: number | null | undefined;
}): number {
  if (params.ingresado === undefined) return params.interesesPendientes;
  return params.ingresado ?? 0;
}
