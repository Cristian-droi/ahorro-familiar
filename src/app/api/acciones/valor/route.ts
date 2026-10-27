import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getOpenPeriodShareValue, getOpenPeriodStatus } from '@/lib/data/share-value';
import { elegirValorDeAccion } from '@/modules/acciones/domain/valor-de-accion';

// POST /api/acciones/valor: the shareholder chooses the share value of the
// open period (RN-2.1, RN-2.2). It is chosen once and never changes mid-year;
// there is no admin exception.
//
// Flow:
//   1. Auth + payload validation.
//   2. The domain validates with the open period, the current value and the
//      allowed values (elegirValorDeAccion).
//   3. The `choose_share_value` RPC writes it with the user's session; the
//      database trigger protects the lock.

const payload = z.object({
  shareValue: z.number().int().positive(),
});

// Messages come from the domain so the DB errors read the same as the
// domain errors.
function mensajeDeErrorDeBase(dbMessage: string, valor: number): string | null {
  if (dbMessage.includes('share_value_locked')) {
    const r = elegirValorDeAccion({ estadoDelPeriodo: 'open', valorActual: valor, valor, permitidos: [valor] });
    return r.ok ? null : r.error.mensaje;
  }
  if (dbMessage.includes('period_not_open')) {
    const r = elegirValorDeAccion({ estadoDelPeriodo: 'closed', valorActual: null, valor, permitidos: [valor] });
    return r.ok ? null : r.error.mensaje;
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const authCheck = await requireUser();
    if ('error' in authCheck) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }
    const { user } = authCheck;

    const parsed = payload.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { shareValue } = parsed.data;

    const supabase = await createSupabaseServerClient();
    const [periodStatus, valorActual, settingRes] = await Promise.all([
      getOpenPeriodStatus(supabase),
      getOpenPeriodShareValue(supabase, user.id),
      supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'allowed_share_values')
        .maybeSingle(),
    ]);
    if (settingRes.error) throw settingRes.error;
    const permitidos = Array.isArray(settingRes.data?.value)
      ? (settingRes.data.value as unknown[]).map(Number).filter((n) => Number.isFinite(n))
      : [];

    const eleccion = elegirValorDeAccion({
      // No open period reads as not open.
      estadoDelPeriodo: periodStatus ?? 'closed',
      valorActual,
      valor: shareValue,
      permitidos,
    });
    if (!eleccion.ok) {
      return NextResponse.json({ error: eleccion.error.mensaje }, { status: 400 });
    }

    const { error } = await supabase.rpc('choose_share_value', {
      p_share_value: eleccion.value,
    });
    if (error) {
      const mensaje = mensajeDeErrorDeBase(`${error.message} ${error.hint ?? ''}`, eleccion.value);
      if (mensaje) {
        return NextResponse.json({ error: mensaje }, { status: 400 });
      }
      console.error('choose_share_value error:', error);
      return NextResponse.json({ error: 'No se pudo guardar el valor de acción' }, { status: 500 });
    }

    return NextResponse.json({ shareValue: eleccion.value });
  } catch (err) {
    console.error('API Error /api/acciones/valor:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
