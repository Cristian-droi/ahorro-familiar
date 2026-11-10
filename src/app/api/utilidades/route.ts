import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getProfileAdminRole } from '@/lib/data/profiles';
import { puedeLeerAdmin } from '@/shared/domain/acceso-admin';
import { consultarUtilidades, resumirUtilidades } from '@/modules/utilidades/application/consultar-utilidades';
import { hoyBogota } from '@/shared/domain/fechas';
import { utilidadesRepo } from '@/modules/utilidades/infra/utilidades-repo';

// GET /api/utilidades?year=2026              → the caller's own profits
// GET /api/utilidades?year=2026&userId=<id>  → one shareholder (gerente or tesorero)
// GET /api/utilidades?year=2026&all=1        → every shareholder (gerente or tesorero)
// GET /api/utilidades?summary=1               → admin indicator for the current period (gerente or tesorero)
// Profits come from utilidades/domain (RN-6), not from SQL.
export async function GET(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const url = new URL(request.url);
    if (url.searchParams.get('summary') === '1') {
      const adminRole = await getProfileAdminRole(supabase, user.id);
      if (!puedeLeerAdmin(adminRole)) {
        return NextResponse.json({ error: 'Acceso restringido a administradores' }, { status: 403 });
      }
      const hoy = hoyBogota(new Date());
      return NextResponse.json(
        await resumirUtilidades(utilidadesRepo, { anio: Number(hoy.slice(0, 4)), mesActual: Number(hoy.slice(5, 7)) }),
      );
    }
    const year = Number(url.searchParams.get('year'));
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ error: 'Año inválido' }, { status: 400 });
    }
    const userId = url.searchParams.get('userId');
    const all = url.searchParams.get('all') === '1';

    if (all || (userId && userId !== user.id)) {
      const adminRole = await getProfileAdminRole(supabase, user.id);
      if (!puedeLeerAdmin(adminRole)) {
        return NextResponse.json({ error: 'Acceso restringido a administradores' }, { status: 403 });
      }
    }

    const porAccionista = await consultarUtilidades(utilidadesRepo, {
      anio: year,
      accionistaId: all ? undefined : (userId ?? user.id),
    });
    if (all) {
      return NextResponse.json({
        utilities: [...porAccionista].flatMap(([id, meses]) => meses.map((m) => ({ user_id: id, ...m }))),
      });
    }
    return NextResponse.json({ utilities: [...porAccionista.values()][0] ?? [] });
  } catch (err) {
    console.error('API Error GET /api/utilidades:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
