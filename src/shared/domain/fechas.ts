// Calendar dates in America/Bogota (docs/arquitectura.md, section 5.2).
// Pure module: the current instant always arrives as a parameter, so the
// domain never calls `new Date()` and tests can fix "today".

import { ok, err, type Result, type ErrorDeDominio } from './result';

const ZONA_BOGOTA = 'America/Bogota';
const FORMATO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

// Calendar date as 'YYYY-MM-DD', the same format the database uses.
// Only build it through `crearFecha` or the functions in this module.
export type FechaISO = string & { readonly __brand: 'FechaISO' };

function componer(anio: number, mes: number, dia: number): FechaISO {
  const mm = String(mes).padStart(2, '0');
  const dd = String(dia).padStart(2, '0');
  return `${anio}-${mm}-${dd}` as FechaISO;
}

function partes(fecha: FechaISO): { anio: number; mes: number; dia: number } {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  return { anio, mes, dia };
}

export function crearFecha(texto: string): Result<FechaISO, ErrorDeDominio> {
  const match = FORMATO_FECHA.exec(texto);
  const invalida = err({ codigo: 'fecha_invalida', mensaje: `La fecha "${texto}" no es válida.` });
  if (!match) return invalida;

  const anio = Number(match[1]);
  const mes = Number(match[2]);
  const dia = Number(match[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > diasDelMes(anio, mes)) return invalida;
  return ok(componer(anio, mes, dia));
}

function esBisiesto(anio: number): boolean {
  return (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
}

function diasDelMes(anio: number, mes: number): number {
  if (mes === 2) return esBisiesto(anio) ? 29 : 28;
  return [4, 6, 9, 11].includes(mes) ? 30 : 31;
}

// Calendar day in Bogota for the given instant.
export function hoyBogota(instante: Date): FechaISO {
  const texto = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_BOGOTA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instante);
  return texto as FechaISO;
}

export function diaDelMes(fecha: FechaISO): number {
  return partes(fecha).dia;
}

export function primerDiaDelMes(fecha: FechaISO): FechaISO {
  const { anio, mes } = partes(fecha);
  return componer(anio, mes, 1);
}

export function mesSiguiente(fecha: FechaISO): FechaISO {
  const { anio, mes } = partes(fecha);
  return mes === 12 ? componer(anio + 1, 1, 1) : componer(anio, mes + 1, 1);
}
