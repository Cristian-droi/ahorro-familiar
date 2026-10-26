// Loan interest (docs/reglas-negocio.md, RN-4.18 to RN-4.22).
// Simple interest on the real outstanding capital: the input is always the
// capital balance, so past-due interest can never earn interest (RN-4.19).

import { diaDelMes, mesesEntre, type FechaISO } from '@/shared/domain/fechas';
import { ok, err, type Result, type ErrorDeDominio } from '@/shared/domain/result';
import { mesAplicado } from '@/modules/prestamos/domain/calendario';

// Configurable parameters (docs/reglas-negocio.md, section 10).
export interface ReglasDeInteres {
  // Monthly rate in basis points: 200 means 2%. Kept as an integer so the
  // interest is computed without binary fractions.
  tasaEnPuntosBasicos: number;
  // RN-4.20: a disbursement after this day pays half the rate in its first month.
  diaLimiteTasaCompleta: number;
  // RN-4.15: a disbursement after this day counts as a loan of the next month.
  diaDeCorte: number;
}

type Tasa = 'ninguna' | 'media' | 'completa';

function tasaDelMes(mes: FechaISO, fechaDesembolso: FechaISO, reglas: ReglasDeInteres): Tasa {
  const aplicado = mesAplicado(fechaDesembolso, reglas.diaDeCorte);
  // 🟡 RN-4.21: before the applied month there is no interest. A disbursement
  // after the cut-off day therefore owes nothing in its own month.
  if (mesesEntre(aplicado, mes) < 0) return 'ninguna';

  // RN-4.20: half rate only in the applied month and only when the money left
  // that same month after the day limit. 🟡 RN-4.21: a loan moved to the next
  // month pays the full rate there, as if disbursed on day 1.
  const esPrimerMes = mesesEntre(aplicado, mes) === 0;
  const desembolsadoEseMes = mesesEntre(fechaDesembolso, mes) === 0;
  if (esPrimerMes && desembolsadoEseMes && diaDelMes(fechaDesembolso) > reglas.diaLimiteTasaCompleta) {
    return 'media';
  }
  return 'completa';
}

const DIVISOR: Record<Exclude<Tasa, 'ninguna'>, number> = { completa: 10000, media: 20000 };

export function interesDelMes(params: {
  saldoCapital: number;
  mes: FechaISO;
  fechaDesembolso: FechaISO;
  reglas: ReglasDeInteres;
}): Result<number, ErrorDeDominio> {
  const { saldoCapital, mes, fechaDesembolso, reglas } = params;
  if (!Number.isInteger(saldoCapital) || saldoCapital < 0) {
    return err({ codigo: 'saldo_invalido', mensaje: 'El saldo del préstamo debe ser un número entero no negativo.' });
  }

  const tasa = tasaDelMes(mes, fechaDesembolso, reglas);
  if (tasa === 'ninguna') return ok(0);
  // RN-4.18: rate × real outstanding balance, rounded to the peso.
  return ok(Math.round((saldoCapital * reglas.tasaEnPuntosBasicos) / DIVISOR[tasa]));
}

export interface InteresesDelPeriodo {
  porMes: { mes: FechaISO; interes: number }[];
  total: number;
}

// RN-4.22: interest accrues month by month as the loan's interest debt.
export function interesesDelPeriodo(params: {
  fechaDesembolso: FechaISO;
  meses: { mes: FechaISO; saldoCapital: number }[];
  reglas: ReglasDeInteres;
}): Result<InteresesDelPeriodo, ErrorDeDominio> {
  const { fechaDesembolso, meses, reglas } = params;
  const porMes: InteresesDelPeriodo['porMes'] = [];

  for (const { mes, saldoCapital } of meses) {
    const r = interesDelMes({ saldoCapital, mes, fechaDesembolso, reglas });
    if (!r.ok) return r;
    porMes.push({ mes, interes: r.value });
  }
  return ok({ porMes, total: porMes.reduce((suma, fila) => suma + fila.interes, 0) });
}
