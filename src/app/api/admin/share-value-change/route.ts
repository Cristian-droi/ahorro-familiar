import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { shareValueChangePermissionError } from '@/lib/data/share-value';

// POST /api/admin/share-value-change: the administrator allows (or revokes)
// one change of a shareholder's open-period share value (RN-2.2).
//
// The `allow_share_value_change` RPC runs with the admin's own session (it
// checks is_admin()), refuses to allow a change after the first share receipt
// and needs a chosen value.

const payload = z.object({
  userId: z.string().uuid(),
  allow: z.boolean(),
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
    const { userId, allow } = parsed.data;

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc('allow_share_value_change', {
      p_profile_id: userId,
      p_allow: allow,
    });
    if (error) {
      const known = shareValueChangePermissionError(`${error.message} ${error.hint ?? ''}`);
      if (known) {
        return NextResponse.json({ error: known.message }, { status: known.status });
      }
      console.error('allow_share_value_change error:', error);
      return NextResponse.json({ error: 'No se pudo actualizar el permiso' }, { status: 500 });
    }

    return NextResponse.json({ allowed: data });
  } catch (err) {
    console.error('API Error /api/admin/share-value-change:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
