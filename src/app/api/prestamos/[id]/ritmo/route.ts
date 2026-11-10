import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getProfileAdminRole } from '@/lib/data/profiles';
import { puedeLeerAdmin } from '@/shared/domain/acceso-admin';
import { hoyBogota, type FechaISO } from '@/shared/domain/fechas';
import { mesAplicado } from '@/modules/prestamos/domain/calendario';
import { ritmoDePago, ritmoDelAccionista } from '@/modules/prestamos/domain/ritmo-de-pago';

// GET /api/prestamos/[id]/ritmo → for an active loan: balance, agreed
// installment of the month and installment to close the year (section 4.7,
// RN-4.30), plus the same added over every active loan of its shareholder.
// Gerente or tesorero only.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    if (!puedeLeerAdmin(await getProfileAdminRole(supabase, user.id))) {
      return NextResponse.json({ error: 'Acceso restringido a administradores' }, { status: 403 });
    }

    const { data: loan, error: loanError } = await supabase
      .from('loans')
      .select('id, user_id, status')
      .eq('id', id)
      .maybeSingle();
    if (loanError) throw loanError;
    if (!loan) return NextResponse.json({ error: 'Préstamo no encontrado' }, { status: 404 });
    if (loan.status !== 'active') {
      return NextResponse.json({ error: 'El préstamo no está activo' }, { status: 409 });
    }

    const { data: loans, error: loansError } = await supabase
      .from('loans')
      .select('id, outstanding_balance, disbursed_at, cutoff_day, loan_payment_plan_items(due_date, capital_amount)')
      .eq('user_id', loan.user_id)
      .eq('status', 'active')
      .not('disbursed_at', 'is', null);
    if (loansError) throw loansError;

    const hoy = hoyBogota(new Date());
    const ritmos = new Map(
      (loans ?? []).map((l) => [
        l.id,
        ritmoDePago({
          saldo: Number(l.outstanding_balance ?? 0),
          mesActual: hoy,
          // RN-4.15 with the cut-off day stored on the loan (RN-4.21b).
          mesAplicado: mesAplicado(hoyBogota(new Date(l.disbursed_at as string)), l.cutoff_day ?? 25),
          plan: (l.loan_payment_plan_items ?? []).map((p) => ({
            mes: p.due_date as FechaISO,
            capital: Number(p.capital_amount),
          })),
        }),
      ]),
    );
    const prestamo = ritmos.get(id);
    if (!prestamo) return NextResponse.json({ error: 'El préstamo no tiene desembolso' }, { status: 409 });

    return NextResponse.json({
      loan: prestamo,
      shareholder: { ...ritmoDelAccionista([...ritmos.values()]), active_loans: ritmos.size },
    });
  } catch (err) {
    console.error('API Error GET /api/prestamos/[id]/ritmo:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
