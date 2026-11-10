// Read use case: profits of a period (RN-6), computed by the domain from the
// stored contributions and paid interest.

import {
  utilidadesDelAnio,
  type AporteDelMes,
  type InteresesDelMes,
} from '@/modules/utilidades/domain/utilidades';

export interface DatosDeUtilidades {
  // Profiles with role 'accionista'.
  accionistas: string[];
  // Approved shares, loan shares and capitalizations of the year, of everyone.
  aportes: AporteDelMes[];
  // Approved interest payments of the year, by the month they belong to.
  interesesPagados: InteresesDelMes[];
}

export interface UtilidadesRepo {
  leerDatosDelAnio(anio: number): Promise<DatosDeUtilidades>;
}

// Same fields the screens read from the former SQL functions.
export interface UtilidadMensualVista {
  month_number: number;
  participation: number;
  utilities_pool: number;
  distribution: number;
}

export async function consultarUtilidades(
  repo: UtilidadesRepo,
  params: { anio: number; accionistaId?: string },
): Promise<Map<string, UtilidadMensualVista[]>> {
  const datos = await repo.leerDatosDelAnio(params.anio);
  const accionistas = params.accionistaId ? [params.accionistaId] : datos.accionistas;
  const porAccionista = utilidadesDelAnio({
    anio: params.anio,
    accionistas,
    aportes: datos.aportes,
    interesesPagados: datos.interesesPagados,
  });
  const vista = new Map<string, UtilidadMensualVista[]>();
  for (const [id, meses] of porAccionista) {
    vista.set(
      id,
      meses.map((m, i) => ({
        month_number: i + 1,
        participation: m.participacion,
        utilities_pool: m.interesesDelMes,
        distribution: m.utilidad,
      })),
    );
  }
  return vista;
}
