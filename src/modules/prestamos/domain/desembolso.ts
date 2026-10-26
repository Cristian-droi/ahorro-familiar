// Loan disbursement and the 4x1000 tax (docs/reglas-negocio.md, RN-4.16).
// The tax is paid only on the net that actually leaves the fund: deductions
// stay in the account, so they are not taxed.

import { ok, err, type Result, type ErrorDeDominio } from '@/shared/domain/result';

export interface Deducciones {
  acciones: number;
  multas: number;
  intereses: number;
  capital: number;
}

export interface Desembolso {
  totalDeducciones: number;
  netoAntesDeImpuesto: number;
  cuatroPorMil: number;
  seTransfiere: number;
}

const formatoPesos = new Intl.NumberFormat('es-CO');

function esEnteroNoNegativo(valor: number): boolean {
  return Number.isInteger(valor) && valor >= 0;
}

export function calcularDesembolso(params: {
  monto: number;
  deducciones: Deducciones;
  // Configurable rate (⚙️) in thousandths: 4 means 0,004. Kept as an integer
  // so the tax is computed without binary fractions.
  tasaPorMil: number;
}): Result<Desembolso, ErrorDeDominio> {
  const { monto, deducciones, tasaPorMil } = params;
  const valores = [deducciones.acciones, deducciones.multas, deducciones.intereses, deducciones.capital];

  if (!Number.isInteger(monto) || monto <= 0 || !valores.every(esEnteroNoNegativo)) {
    return err({
      codigo: 'valor_invalido',
      mensaje: 'El monto y las deducciones deben ser números enteros, y el monto debe ser mayor que cero.',
    });
  }

  const totalDeducciones = valores.reduce((suma, valor) => suma + valor, 0);
  if (totalDeducciones > monto) {
    return err({
      codigo: 'deducciones_mayores_al_monto',
      mensaje: `Las deducciones (${formatoPesos.format(totalDeducciones)}) superan el monto del préstamo (${formatoPesos.format(monto)}).`,
    });
  }

  const netoAntesDeImpuesto = monto - totalDeducciones;
  // RN-4.16: 4x1000 = ROUND(net before tax × 0,004).
  const cuatroPorMil = Math.round((netoAntesDeImpuesto * tasaPorMil) / 1000);
  return ok({
    totalDeducciones,
    netoAntesDeImpuesto,
    cuatroPorMil,
    seTransfiere: netoAntesDeImpuesto - cuatroPorMil,
  });
}
