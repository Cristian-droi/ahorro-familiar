// Whether a shareholder is up to date with shares, fines and loan interest
// (docs/reglas-negocio.md, RN-2.3, RN-3.1, RN-3.4 and RN-4.22).

import type { ReglasDeCompra } from '@/modules/acciones/domain/compra';
import { multaDelMes, type ReglasDeMulta } from '@/modules/acciones/domain/multas';
import { validarPuedeComprar } from '@/modules/acciones/domain/valor-de-accion';
import { diaDelMes, primerDiaDelMes, sumarMeses, type FechaISO } from '@/shared/domain/fechas';

const NOMBRES_DE_MES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export interface PrestamoActivo {
  id: string;
  numero: number | null;
  numeroDeDesembolso: string | null;
  saldo: number;
  // RN-4.22: interest debt of this loan.
  interesAdeudado: number;
}

export interface EntradaDeObligaciones {
  hoy: FechaISO;
  reglas: { compra: ReglasDeCompra; multa: ReglasDeMulta };
  // RN-2.3: null while the period share value is not chosen.
  valorDeAccion: number | null;
  // Approved share items of the year; several items of a month add up.
  accionesCompradas: { mes: FechaISO; acciones: number }[];
  mesesConMultaPagada: FechaISO[];
  prestamos: PrestamoActivo[];
}

export interface MesEnMora {
  mes: FechaISO;
  nombreDelMes: string;
  accionesAdeudadas: number;
  valorDeAccion: number;
  multa: number;
}

export interface EstadoDeObligaciones {
  alDia: boolean;
  razones: string[];
  faltanAcciones: boolean;
  valorDeAccion: number | null;
  multasPendientes: boolean;
  debeIntereses: boolean;
  accionesAdeudadas: number;
  montoAcciones: number;
  montoMultas: number;
  montoIntereses: number;
  total: number;
  mesesEnMora: MesEnMora[];
  prestamos: PrestamoActivo[];
}

// Months from January to the current month; the current month is required
// only after its grace days (RN-3.4).
function mesesExigidos(hoy: FechaISO, diasDeGracia: number): FechaISO[] {
  const enero = sumarMeses(hoy, -(Number(hoy.slice(5, 7)) - 1));
  const meses: FechaISO[] = [];
  for (let mes = enero; mes <= primerDiaDelMes(hoy); mes = sumarMeses(mes, 1)) meses.push(mes);
  if (diaDelMes(hoy) <= diasDeGracia) meses.pop();
  return meses;
}

function nombreDelPrestamo(p: PrestamoActivo): string {
  if (!p.numero) return 'préstamo activo';
  return `Préstamo #${p.numero}${p.numeroDeDesembolso ? ` (${p.numeroDeDesembolso})` : ''}`;
}

export function estadoDeObligaciones(entrada: EntradaDeObligaciones): EstadoDeObligaciones {
  const { hoy, reglas, valorDeAccion, prestamos } = entrada;
  const anio = hoy.slice(0, 4);
  const razones: string[] = [];
  let faltanAcciones = false;
  let multasPendientes = false;

  // RN-2.3: without a chosen value the shareholder is not up to date and the
  // share amount is 0, but late fines still accrue (Cris, 2026-10-27).
  const puedeComprar = validarPuedeComprar({ valorDeAccion });
  if (!puedeComprar.ok) {
    razones.push(puedeComprar.error.mensaje);
    faltanAcciones = true;
  }
  const valorUnitario = puedeComprar.ok ? puedeComprar.value : 0;

  const compradasPorMes = new Map<string, number>();
  for (const { mes, acciones } of entrada.accionesCompradas) {
    compradasPorMes.set(mes, (compradasPorMes.get(mes) ?? 0) + acciones);
  }
  const multaPagada = new Set<string>(entrada.mesesConMultaPagada);

  let accionesAdeudadas = 0;
  let montoAcciones = 0;
  let montoMultas = 0;
  const mesesEnMora: MesEnMora[] = [];

  for (const mes of mesesExigidos(hoy, reglas.multa.diasDeGracia)) {
    // RN-3.1: the monthly minimum.
    const adeudadas = Math.max(0, reglas.compra.minAccionesPorMes - (compradasPorMes.get(mes) ?? 0));
    if (adeudadas === 0) continue;
    const nombreDelMes = NOMBRES_DE_MES[Number(mes.slice(5, 7)) - 1];
    razones.push(`Debés comprar el mínimo de acciones (${reglas.compra.minAccionesPorMes}) para ${nombreDelMes} ${anio}.`);
    faltanAcciones = true;
    accionesAdeudadas += adeudadas;
    montoAcciones += adeudadas * valorUnitario;

    // RN-3.4: the fine of this month, unless it was already paid.
    const multa = multaPagada.has(mes) ? 0 : multaDelMes({ mes, hoy, reglas: reglas.multa });
    if (multa > 0) {
      razones.push(`Tenés una multa pendiente por mora en acciones de ${nombreDelMes} ${anio}.`);
      multasPendientes = true;
      montoMultas += multa;
    }
    mesesEnMora.push({ mes, nombreDelMes, accionesAdeudadas: adeudadas, valorDeAccion: valorUnitario, multa });
  }

  // RN-4.22: interest debt of each active loan.
  let montoIntereses = 0;
  let debeIntereses = false;
  for (const prestamo of prestamos) {
    if (prestamo.interesAdeudado > 0) {
      razones.push(`Tenés intereses en mora en tu ${nombreDelPrestamo(prestamo)}.`);
      debeIntereses = true;
      montoIntereses += prestamo.interesAdeudado;
    }
  }

  return {
    alDia: razones.length === 0,
    razones,
    faltanAcciones,
    valorDeAccion,
    multasPendientes,
    debeIntereses,
    accionesAdeudadas,
    montoAcciones,
    montoMultas,
    montoIntereses,
    total: montoAcciones + montoMultas + montoIntereses,
    mesesEnMora,
    prestamos,
  };
}
