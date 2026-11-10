// Profits of the period (docs/reglas-negocio.md, section 6).

import { sumarMeses, type FechaISO } from '@/shared/domain/fechas';

// RN-6.3: utilidad(mes) = intereses pagados en el mes × participación(mes), with
// participación = aporte del accionista / aporte del grupo (RN-6.2). Rounded to
// the peso, half up, as the stored history was. Integer math, so large amounts
// keep exact pesos.
export function utilidadDelMes(params: {
  aporteDelAccionista: number;
  aporteDelGrupo: number;
  interesesPagados: number;
}): number {
  const { aporteDelAccionista, aporteDelGrupo, interesesPagados } = params;
  if (aporteDelGrupo <= 0 || aporteDelAccionista <= 0 || interesesPagados <= 0) return 0;
  const numerador = BigInt(aporteDelAccionista) * BigInt(interesesPagados);
  const total = BigInt(aporteDelGrupo);
  const dos = BigInt(2);
  return Number((numerador * dos + total) / (total * dos));
}

export interface AporteDelMes {
  accionistaId: string;
  // First day of the month the contribution counts for (target_month).
  mes: FechaISO;
  // Shares, loan shares and capitalizations (RN-6.2). Fines never enter (RN-6.4).
  monto: number;
}

export interface InteresesDelMes {
  // RN-6.1 (Cris, 2026-11-10): the month the interest belongs to, not the day it
  // was paid. Interest paid in June for May is May's profit.
  mes: FechaISO;
  monto: number;
}

export interface UtilidadMensual {
  mes: FechaISO;
  interesesDelMes: number;
  utilidad: number;
}

// The twelve months of the period for every shareholder. Contributions
// accumulate from January of the period, since the liquidation resets them
// every year (the January capitalization is a January contribution).
export function utilidadesDelAnio(params: {
  anio: number;
  accionistas: string[];
  aportes: AporteDelMes[];
  interesesPagados: InteresesDelMes[];
}): Map<string, UtilidadMensual[]> {
  const enero = `${params.anio}-01-01` as FechaISO;
  const meses = Array.from({ length: 12 }, (_, i) => sumarMeses(enero, i));
  const finDelAnio = sumarMeses(enero, 12);

  const aportesDelAnio = params.aportes.filter((a) => a.mes >= enero && a.mes < finDelAnio);
  const interesesPorMes = new Map<string, number>();
  for (const i of params.interesesPagados) {
    interesesPorMes.set(i.mes, (interesesPorMes.get(i.mes) ?? 0) + i.monto);
  }

  const resultado = new Map<string, UtilidadMensual[]>(params.accionistas.map((id) => [id, []]));
  const acumuladoPorAccionista = new Map<string, number>();
  let acumuladoDelGrupo = 0;

  for (const mes of meses) {
    for (const a of aportesDelAnio) {
      if (a.mes !== mes) continue;
      acumuladoPorAccionista.set(a.accionistaId, (acumuladoPorAccionista.get(a.accionistaId) ?? 0) + a.monto);
      acumuladoDelGrupo += a.monto;
    }
    const interesesDelMes = interesesPorMes.get(mes) ?? 0;
    for (const [id, filas] of resultado) {
      filas.push({
        mes,
        interesesDelMes,
        utilidad: utilidadDelMes({
          aporteDelAccionista: acumuladoPorAccionista.get(id) ?? 0,
          aporteDelGrupo: acumuladoDelGrupo,
          interesesPagados: interesesDelMes,
        }),
      });
    }
  }
  return resultado;
}
