import 'server-only';
import { z } from 'zod';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { FechaISO } from '@/shared/domain/fechas';
import type { DatosDeUtilidades, UtilidadesRepo } from '@/modules/utilidades/application/consultar-utilidades';

// Profits need every shareholder's contributions (the group total), which RLS
// hides from a shareholder, so this reads with the service role. Callers must
// check who may see which shareholder before using it.

const PAGINA = 1000;
const APORTES = ['acciones', 'acciones_prestamo', 'capitalizacion'] as const;

// Rows that feed a money calculation are checked, never cast.
const filaSchema = z.object({
  concept: z.enum([...APORTES, 'pago_intereses']),
  target_month: z.string().regex(/^\d{4}-\d{2}-01$/),
  amount: z.coerce.number().int().nonnegative(),
  receipts: z.object({ user_id: z.string().uuid() }),
});
type Fila = z.infer<typeof filaSchema>;

async function leerItemsAprobados(anio: number): Promise<Fila[]> {
  const admin = createSupabaseAdminClient();
  const filas: Fila[] = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await admin
      .from('receipt_items')
      .select('id, concept, target_month, amount, receipts!inner(user_id, status)')
      .eq('receipts.status', 'approved')
      .in('concept', [...APORTES, 'pago_intereses'])
      .gte('target_month', `${anio}-01-01`)
      .lt('target_month', `${anio + 1}-01-01`)
      .order('id')
      .range(desde, desde + PAGINA - 1);
    if (error) throw error;
    filas.push(...z.array(filaSchema).parse(data ?? []));
    if (!data || data.length < PAGINA) return filas;
  }
}

export const utilidadesRepo: UtilidadesRepo = {
  async leerDatosDelAnio(anio: number): Promise<DatosDeUtilidades> {
    const admin = createSupabaseAdminClient();
    const [items, perfiles] = await Promise.all([
      leerItemsAprobados(anio),
      admin.from('profiles').select('id').eq('role', 'accionista'),
    ]);
    if (perfiles.error) throw perfiles.error;

    const datos: DatosDeUtilidades = {
      accionistas: (perfiles.data ?? []).map((p) => p.id),
      aportes: [],
      interesesPagados: [],
    };
    for (const it of items) {
      const mes = it.target_month as FechaISO;
      const monto = it.amount;
      if (it.concept === 'pago_intereses') datos.interesesPagados.push({ mes, monto });
      else datos.aportes.push({ accionistaId: it.receipts.user_id, mes, monto });
    }
    return datos;
  },
};
