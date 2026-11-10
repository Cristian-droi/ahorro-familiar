// What the tesorero sees for an active loan (docs/reglas-negocio.md, section 4.7):
// the balance, the agreed installment of the month and the installment to
// close the year (RN-4.30).

import { primerDiaDelMes, type FechaISO } from '@/shared/domain/fechas';
import { cuotaParaCerrarElAnio } from '@/modules/prestamos/domain/cuota-de-cierre';

export interface RitmoDePago {
  saldo: number;
  // Capital agreed for the current month in the plan (RN-4.3b).
  cuotaPactadaDelMes: number;
  cuotaParaCerrar: number;
  // Last month of the agreed plan.
  mesFinal: FechaISO;
}

export function ritmoDePago(params: {
  saldo: number;
  mesActual: FechaISO;
  // RN-4.15.
  mesAplicado: FechaISO;
  plan: { mes: FechaISO; capital: number }[];
}): RitmoDePago {
  const mesActual = primerDiaDelMes(params.mesActual);
  const meses = params.plan.map((c) => primerDiaDelMes(c.mes));
  const mesFinal = meses.reduce((ultimo, mes) => (mes > ultimo ? mes : ultimo), primerDiaDelMes(params.mesAplicado));
  const cuotaPactadaDelMes = params.plan
    .filter((c) => primerDiaDelMes(c.mes) === mesActual)
    .reduce((suma, c) => suma + c.capital, 0);

  const cuota = cuotaParaCerrarElAnio({
    saldo: params.saldo,
    mesInicial: primerDiaDelMes(params.mesAplicado),
    mesActual,
    mesFinal,
  });
  let cuotaParaCerrar: number;
  if (cuota.ok) cuotaParaCerrar = cuota.value;
  // Past the term, everything left is due now.
  else if (cuota.error.codigo === 'fuera_del_plazo') cuotaParaCerrar = params.saldo;
  // RN-4.15: the loan starts next month, so nothing is due yet.
  else cuotaParaCerrar = 0;

  return { saldo: params.saldo, cuotaPactadaDelMes, cuotaParaCerrar, mesFinal };
}

// Section 4.7: the installment to close the year adds every active loan of
// the shareholder.
export function ritmoDelAccionista(prestamos: RitmoDePago[]): Omit<RitmoDePago, 'mesFinal'> {
  return prestamos.reduce(
    (total, p) => ({
      saldo: total.saldo + p.saldo,
      cuotaPactadaDelMes: total.cuotaPactadaDelMes + p.cuotaPactadaDelMes,
      cuotaParaCerrar: total.cuotaParaCerrar + p.cuotaParaCerrar,
    }),
    { saldo: 0, cuotaPactadaDelMes: 0, cuotaParaCerrar: 0 },
  );
}
