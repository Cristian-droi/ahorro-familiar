import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getProfileAdminRole } from '@/lib/data/profiles';
import { getAllActiveLoansDebt } from '@/lib/data/loans';
import { puedeLeerAdmin } from '@/shared/domain/acceso-admin';
import { deudaPorAccionista } from '@/modules/prestamos/domain/deuda-por-accionista';

// GET /api/prestamos/deuda → for each shareholder with active loans, the
// outstanding capital and the interest owed, computed by the domain (RN-4.22,
// RN-4.27). Gerente or tesorero only.
export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const adminRole = await getProfileAdminRole(supabase, user.id);
    if (!puedeLeerAdmin(adminRole)) {
      return NextResponse.json({ error: 'Acceso restringido a administradores' }, { status: 403 });
    }

    const loans = await getAllActiveLoansDebt(supabase);
    const porAccionista = deudaPorAccionista(
      loans.map((l) => ({ accionistaId: l.user_id, saldoCapital: l.outstanding_capital, interesAdeudado: l.interest_owed })),
    );
    return NextResponse.json({
      debts: [...porAccionista].map(([userId, d]) => ({
        user_id: userId,
        outstanding_capital: d.saldoCapital,
        interest_owed: d.interesAdeudado,
      })),
    });
  } catch (err) {
    console.error('API Error GET /api/prestamos/deuda:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
