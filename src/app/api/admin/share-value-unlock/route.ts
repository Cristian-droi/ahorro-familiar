import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { shareValueLockPayload } from '@/lib/schemas/share-value-lock';

// Admin-only: permite (o revoca) que uno o todos los accionistas puedan
// cambiar su `selected_share_value`.
//
// - scope=user: toggle sobre un profile específico.
// - scope=all:  toggle sobre todos los accionistas.
//
// El cambio solo afecta al flag `share_value_change_allowed`. El valor
// actual de acción no se modifica aquí — si el admin quisiera resetearlo
// sería una operación separada (no prevista por ahora).
//
// Usamos el admin client (service_role) para bypassear RLS; el trigger de
// bloqueo no aplica porque no estamos tocando `selected_share_value`.

export async function POST(request: Request) {
  try {
    const authCheck = await requireAdmin();
    if ('error' in authCheck) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const parsed = shareValueLockPayload.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const admin = createSupabaseAdminClient();
    const payload = parsed.data;

    if (payload.scope === 'user') {
      const { error } = await admin
        .from('profiles')
        .update({ share_value_change_allowed: payload.allow })
        .eq('id', payload.userId);

      if (error) {
        console.error('share-value-unlock user error:', error);
        return NextResponse.json(
          { error: 'No se pudo actualizar el permiso del usuario' },
          { status: 500 },
        );
      }

      return NextResponse.json({ success: true, scope: 'user' });
    }

    // scope === 'all'  → solo accionistas, el admin no "compra" acciones.
    const { error, count } = await admin
      .from('profiles')
      .update({ share_value_change_allowed: payload.allow }, { count: 'exact' })
      .eq('role', 'accionista');

    if (error) {
      console.error('share-value-unlock all error:', error);
      return NextResponse.json(
        { error: 'No se pudo actualizar el permiso global' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, scope: 'all', updated: count ?? 0 });
  } catch (err) {
    console.error('API Error /api/admin/share-value-unlock:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
