import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { guardarAjustes, leerAjustes } from '@/modules/parametros/infra/ajustes-repo';
import type { Json } from '@/types/database';
import {
  AJUSTE_DIA_DE_CORTE,
  AJUSTE_DIA_LIMITE_TASA_COMPLETA,
  validarAjustesAGuardar,
} from '@/modules/parametros/domain/validar-ajustes';

// POST /api/admin/settings: the administrator saves the ajustes page settings
// (docs/reglas-negocio.md, section 10 ⚙️).
//
// `system_settings` only lets `authenticated` read; only service_role writes.
// This route checks the caller is admin, validates every value with the
// parametros domain (only the keys the ajustes page edits) and writes all of
// them in one upsert, or nothing.

const payload = z.object({
  settings: z
    .array(z.object({ key: z.string().min(1), value: z.unknown() }))
    .min(1),
});

export async function POST(request: Request) {
  try {
    const authCheck = await requireAdmin();
    if ('error' in authCheck) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const parsed = payload.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    // The stored days, for the cross-field check when only one day is sent (RN-4.21).
    const guardados = await leerAjustes([AJUSTE_DIA_LIMITE_TASA_COMPLETA, AJUSTE_DIA_DE_CORTE]);
    if (!guardados.ok) {
      console.error('system_settings read error:', guardados.mensaje);
      return NextResponse.json({ error: 'No se pudo leer la configuración actual' }, { status: 500 });
    }

    const entrantes = parsed.data.settings.map((s) => ({ key: s.key, value: s.value }));
    const validados = validarAjustesAGuardar(entrantes, guardados.value);
    if (!validados.ok) {
      return NextResponse.json(
        { error: validados.error.mensaje, codigo: validados.error.codigo },
        { status: 400 },
      );
    }

    // Validated values are JSON (numbers, booleans and number lists).
    // `updated_at` only has an insert default, so it is set on every save.
    const filas = validados.value.map((f) => ({ key: f.key, value: f.value as Json }));
    const guardado = await guardarAjustes(filas, new Date().toISOString());
    if (!guardado.ok) {
      console.error('system_settings upsert error:', guardado.mensaje);
      return NextResponse.json({ error: 'No se pudo guardar la configuración' }, { status: 500 });
    }

    return NextResponse.json({ saved: filas.map((f) => f.key) });
  } catch (err) {
    console.error('API Error /api/admin/settings:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
