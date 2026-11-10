import { describe, it, expect, vi } from 'vitest';
import { consultarUtilidades, type UtilidadesRepo } from '@/modules/utilidades/application/consultar-utilidades';
import type { FechaISO } from '@/shared/domain/fechas';

const f = (texto: string) => texto as FechaISO;

function repo(): UtilidadesRepo & { leerDatosDelAnio: ReturnType<typeof vi.fn> } {
  return {
    leerDatosDelAnio: vi.fn().mockResolvedValue({
      accionistas: ['ana', 'luis'],
      aportes: [
        { accionistaId: 'ana', mes: f('2026-04-01'), monto: 300_000 },
        { accionistaId: 'luis', mes: f('2026-04-01'), monto: 700_000 },
        // The tesorero also buys shares: their money counts for the group total.
        { accionistaId: 'tere', mes: f('2026-04-01'), monto: 1_000_000 },
      ],
      interesesPagados: [{ mes: f('2026-04-01'), monto: 100_000 }],
    }),
  };
}

describe('consultarUtilidades (RN-6)', () => {
  it('RN-6.3: one shareholder gets the twelve months in the shape the screens read', async () => {
    const r = repo();
    const meses = await consultarUtilidades(r, { anio: 2026, accionistaId: 'ana' });
    expect(r.leerDatosDelAnio).toHaveBeenCalledWith(2026);
    expect(meses.get('ana')).toHaveLength(12);
    expect(meses.get('ana')?.[3]).toEqual({ month_number: 4, participation: 0.15, utilities_pool: 100_000, distribution: 15_000 });
    expect(meses.size).toBe(1);
  });

  it('a single shareholder is answered even when not in the shareholder list', async () => {
    const meses = await consultarUtilidades(repo(), { anio: 2026, accionistaId: 'tere' });
    expect(meses.get('tere')?.[3].distribution).toBe(50_000);
  });

  it('all shareholders, for the admin views', async () => {
    const meses = await consultarUtilidades(repo(), { anio: 2026 });
    expect([...meses.keys()]).toEqual(['ana', 'luis']);
    expect(meses.get('luis')?.[3].distribution).toBe(35_000);
  });
});
