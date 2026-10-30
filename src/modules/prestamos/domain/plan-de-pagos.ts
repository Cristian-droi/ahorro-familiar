// Agreed payment plan of a loan (docs/reglas-negocio.md, section 4.7 "Plan pactado").
// Term chosen by the shareholder up to a maximum (RN-4.3), applied month from
// RN-4.15, capital agreed per calendar month (RN-4.3b, RN-4.26) and interest per
// month from RN-4.18 to RN-4.21. Whole pesos throughout.

import { crearFecha, mesesEntre, primerDiaDelMes, sumarMeses, type FechaISO } from '@/shared/domain/fechas';
import { ok, err, type Result, type ErrorDeDominio } from '@/shared/domain/result';
import { mesAplicado, plazoDelPrestamo } from '@/modules/prestamos/domain/calendario';
import { interesDelMes, type ReglasDeInteres } from '@/modules/prestamos/domain/intereses';

export interface CuotaDelPlan {
  // 1 for the applied month (RN-4.15), up to the last month of the term.
  numero: number;
  // First day of the installment's month.
  mes: FechaISO;
  capital: number;
  interes: number;
  saldoDespues: number;
}

// Capital of each installment, by installment number (1 = applied month).
// Without edits the amount is split in equal
// whole-peso parts and the last installment absorbs the remainder. With edits
// (RN-4.26: the capital payment is free):
//   a) an edited installment keeps its value;
//   b) unedited installments before the last edited one keep the equal part,
//      unless that exceeds the amount, in which case they drop to zero;
//   c) unedited installments after the last edited one share what is left in
//      equal parts, the last of them absorbing the remainder; when there are
//      none, the last installment absorbs the difference.
function capitalDeCadaCuota(monto: number, meses: number, editadas: Record<number, number>): number[] {
  const parteIgual = Math.floor(monto / meses);
  const claves = Object.keys(editadas).map(Number).sort((a, b) => a - b);
  const capitales: number[] = new Array(meses).fill(0);

  if (claves.length === 0) {
    for (let i = 0; i < meses; i++) {
      capitales[i] = i === meses - 1 ? monto - parteIgual * (meses - 1) : parteIgual;
    }
    return capitales;
  }

  const ultimaEditada = claves[claves.length - 1];
  for (let n = 1; n <= meses; n++) {
    if (editadas[n] !== undefined) capitales[n - 1] = editadas[n];
    else if (n < ultimaEditada) capitales[n - 1] = parteIgual;
  }

  const suma = () => capitales.reduce((s, v) => s + v, 0);
  let restante = monto - suma();
  if (restante < 0) {
    for (let n = 1; n < ultimaEditada && n <= meses; n++) {
      if (editadas[n] === undefined) capitales[n - 1] = 0;
    }
    restante = Math.max(0, monto - suma());
  }

  const posteriores: number[] = [];
  for (let n = ultimaEditada + 1; n <= meses; n++) {
    if (editadas[n] === undefined) posteriores.push(n);
  }

  if (posteriores.length > 0) {
    const parte = Math.floor(restante / posteriores.length);
    posteriores.forEach((n, i) => {
      capitales[n - 1] = i === posteriores.length - 1 ? restante - parte * (posteriores.length - 1) : parte;
    });
  } else if (restante !== 0) {
    capitales[meses - 1] += restante;
  }
  return capitales;
}

export function planDePagos(params: {
  monto: number;
  fechaDesembolso: FechaISO;
  reglas: ReglasDeInteres;
  // RN-4.3: the admin can allow (⚙️) terms until December of the next period.
  hastaPeriodoSiguiente: boolean;
  // RN-4.3: last month of the term chosen by the shareholder (any day of that
  // month). Without it the plan uses the maximum term.
  mesFinal?: FechaISO;
  // RN-4.3b: agreed capital by calendar month, keyed by a 'YYYY-MM-DD' date of
  // that month. Capital of a month before the applied month goes to the last month.
  capitalPorMes?: Record<string, number>;
}): Result<CuotaDelPlan[], ErrorDeDominio> {
  const { monto, fechaDesembolso, reglas, hastaPeriodoSiguiente, capitalPorMes = {} } = params;
  if (!Number.isInteger(monto) || monto <= 0) {
    return err({ codigo: 'monto_invalido', mensaje: 'El monto del préstamo debe ser un número entero positivo.' });
  }

  const acordado: { mes: FechaISO; capital: number }[] = [];
  for (const [clave, valor] of Object.entries(capitalPorMes)) {
    if (!Number.isInteger(valor) || valor < 0) {
      return err({
        codigo: 'capital_invalido',
        mensaje: 'El capital de cada cuota debe ser un número entero no negativo.',
      });
    }
    const mes = crearFecha(clave);
    if (!mes.ok) {
      return err({ codigo: 'mes_invalido', mensaje: `El mes "${clave}" del plan no es una fecha válida.` });
    }
    acordado.push({ mes: primerDiaDelMes(mes.value), capital: valor });
  }

  const inicio = mesAplicado(fechaDesembolso, reglas.diaDeCorte);
  const maximo = plazoDelPrestamo({ mesAplicado: inicio, hastaPeriodoSiguiente });
  const mesFinal = params.mesFinal === undefined ? maximo.mesFinal : primerDiaDelMes(params.mesFinal);
  if (mesesEntre(inicio, mesFinal) < 0) {
    return err({
      codigo: 'plazo_antes_del_mes_aplicado',
      mensaje: 'El plazo no puede terminar antes del primer mes del préstamo.',
    });
  }
  if (mesesEntre(mesFinal, maximo.mesFinal) < 0) {
    return err({
      codigo: 'plazo_mayor_al_maximo',
      mensaje: `El plazo puede ir como máximo hasta diciembre de ${maximo.mesFinal.slice(0, 4)} (${maximo.meses} meses).`,
    });
  }
  const meses = mesesEntre(inicio, mesFinal) + 1;

  // RN-4.3b: capital agreed for a month before the applied month (the
  // disbursement was delayed) moves to the last month of the plan.
  let movidoAlFinal = 0;
  const editadas: Record<number, number> = {};
  for (const { mes, capital } of acordado) {
    const indice = mesesEntre(inicio, mes);
    if (indice >= meses) {
      return err({
        codigo: 'capital_fuera_del_plazo',
        mensaje: 'Hay capital asignado a un mes después del último mes del plazo.',
      });
    }
    if (indice < 0) movidoAlFinal += capital;
    else editadas[indice + 1] = (editadas[indice + 1] ?? 0) + capital;
  }

  // The rest of the amount follows the RN-4.26 distribution; the moved capital
  // is then added to the last month.
  const capitales = capitalDeCadaCuota(Math.max(0, monto - movidoAlFinal), meses, editadas);
  capitales[meses - 1] += movidoAlFinal;

  const cuotas: CuotaDelPlan[] = [];
  let saldo = monto;
  for (let i = 0; i < meses; i++) {
    const mes = sumarMeses(inicio, i);
    // RN-4.18: interest on the outstanding balance at the start of the month.
    const interes = interesDelMes({ saldoCapital: saldo, mes, fechaDesembolso, reglas });
    if (!interes.ok) return interes;
    const capital = Math.min(capitales[i], saldo);
    saldo -= capital;
    cuotas.push({ numero: i + 1, mes, capital, interes: interes.value, saldoDespues: saldo });
  }
  return ok(cuotas);
}

// RN-4.3b: the agreed plan stored as one row per calendar month, read back as
// the chosen last month and the capital per month. A month must appear once:
// the plan is never merged here.
export function planAcordadoDesdeCuotas(
  cuotas: { mes: FechaISO; capital: number }[],
): Result<{ mesFinal: FechaISO | undefined; capitalPorMes: Record<string, number> }, ErrorDeDominio> {
  let mesFinal: FechaISO | undefined;
  const capitalPorMes: Record<string, number> = {};
  for (const { mes, capital } of cuotas) {
    if (!Number.isInteger(capital) || capital < 0) {
      return err({ codigo: 'capital_invalido', mensaje: 'El capital de cada cuota debe ser un número entero no negativo.' });
    }
    if (mes in capitalPorMes) {
      return err({ codigo: 'mes_duplicado', mensaje: 'El plan pactado tiene dos cuotas en el mismo mes.' });
    }
    capitalPorMes[mes] = capital;
    if (mesFinal === undefined || mes > mesFinal) mesFinal = mes;
  }
  return ok({ mesFinal, capitalPorMes });
}

