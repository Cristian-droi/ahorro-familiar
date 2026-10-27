// Share value per period (docs/reglas-negocio.md, RN-2.1 to RN-2.3).

import { formatearPesos } from '@/shared/domain/dinero';
import { ok, err, type Result, type ErrorDeDominio } from '@/shared/domain/result';

// docs/modelo-datos.md, `period_status`.
export type EstadoDelPeriodo = 'open' | 'closing' | 'closed';

function enumerar(valores: number[]): string {
  const textos = valores.map(formatearPesos);
  if (textos.length <= 1) return textos.join('');
  return `${textos.slice(0, -1).join(', ')} o ${textos[textos.length - 1]}`;
}

// RN-2.2: the value is chosen once per period and never changes mid-year.
export function elegirValorDeAccion(params: {
  estadoDelPeriodo: EstadoDelPeriodo;
  // The value already chosen in this period, or null.
  valorActual: number | null;
  valor: number;
  // RN-2.1: configurable allowed values.
  permitidos: number[];
}): Result<number, ErrorDeDominio> {
  const { estadoDelPeriodo, valorActual, valor, permitidos } = params;
  if (estadoDelPeriodo !== 'open') {
    return err({
      codigo: 'periodo_no_abierto',
      mensaje: 'El valor de la acción solo se elige mientras el periodo está abierto.',
    });
  }
  if (valorActual !== null) {
    return err({
      codigo: 'valor_ya_elegido',
      mensaje: 'Ya elegiste el valor de tu acción para este periodo. No se puede cambiar a mitad de año.',
    });
  }
  if (!permitidos.includes(valor)) {
    return err({
      codigo: 'valor_no_permitido',
      mensaje: `El valor de la acción debe ser uno de los permitidos: ${enumerar(permitidos)}.`,
    });
  }
  return ok(valor);
}

// RN-2.3: no purchase until the period share value is chosen.
export function validarPuedeComprar(params: { valorDeAccion: number | null }): Result<number, ErrorDeDominio> {
  if (params.valorDeAccion === null) {
    return err({ codigo: 'sin_valor_de_accion', mensaje: 'Primero elige el valor de tu acción para este periodo.' });
  }
  return ok(params.valorDeAccion);
}
