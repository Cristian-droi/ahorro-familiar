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
