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

// Messages shared with the routes that map the database errors (RN-2.2), so
// both read the same.
export const MENSAJE_PERIODO_NO_ABIERTO = 'El valor de la acción solo se elige mientras el periodo está abierto.';
export const MENSAJE_VALOR_BLOQUEADO_POR_COMPRA =
  'Ya compraste acciones con este valor. Podrás cambiarlo en el próximo periodo.';
export const MENSAJE_VALOR_YA_ELEGIDO =
  'Ya elegiste el valor de tu acción para este periodo. Para cambiarlo, pídele al administrador que lo habilite.';

// RN-2.2: the value is chosen per period. It changes only with the
// administrator permission and before the first share receipt is sent.
export function elegirValorDeAccion(params: {
  estadoDelPeriodo: EstadoDelPeriodo;
  // The value already chosen in this period, or null.
  valorActual: number | null;
  // The administrator allowed one change.
  cambioHabilitado: boolean;
  // A pending or approved share receipt exists in the period.
  tieneCompras: boolean;
  valor: number;
  // RN-2.1: configurable allowed values.
  permitidos: number[];
}): Result<number, ErrorDeDominio> {
  const { estadoDelPeriodo, valorActual, cambioHabilitado, tieneCompras, valor, permitidos } = params;
  if (estadoDelPeriodo !== 'open') {
    return err({
      codigo: 'periodo_no_abierto',
      mensaje: MENSAJE_PERIODO_NO_ABIERTO,
    });
  }
  if (valorActual !== null && tieneCompras) {
    return err({
      codigo: 'valor_bloqueado_por_compra',
      mensaje: MENSAJE_VALOR_BLOQUEADO_POR_COMPRA,
    });
  }
  if (valorActual !== null && !cambioHabilitado) {
    return err({
      codigo: 'valor_ya_elegido',
      mensaje: MENSAJE_VALOR_YA_ELEGIDO,
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
