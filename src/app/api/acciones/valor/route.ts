import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  getOpenPeriodMembership,
  getOpenPeriodStatus,
  hasShareReceiptsInOpenPeriod,
  shareValueChoiceErrorMessage,
} from '@/lib/data/share-value';
import { elegirValorDeAccion } from '@/modules/acciones/domain/valor-de-accion';

// POST /api/acciones/valor: the shareholder chooses the share value of the
// open period (RN-2.1, RN-2.2). A chosen value changes only once the admin
// allowed it (one change) and before the first share receipt; after that it
// stays fixed until the next period.
//
// Flow:
//   1. Auth + payload validation.
//   2. The domain validates with the open period, the current value, the
//      admin permission, the share receipts and the allowed values
//      (elegirValorDeAccion).
//   3. The `choose_share_value` RPC writes it with the user's session; the
//      database trigger protects the lock and consumes the permission.

const payload = z.object({
  shareValue: z.number().int().positive(),
});

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
    const [periodStatus, membership, tieneCompras, settingRes] = await Promise.all([
      getOpenPeriodStatus(supabase),
      getOpenPeriodMembership(supabase, user.id),
      hasShareReceiptsInOpenPeriod(supabase, user.id),
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
      valorActual: membership?.shareValue ?? null,
      cambioHabilitado: membership?.changeAllowed ?? false,
      tieneCompras,
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
      const mensaje = shareValueChoiceErrorMessage(`${error.message} ${error.hint ?? ''}`);
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
