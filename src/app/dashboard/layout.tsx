'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import {
  Home,
  FileText,
  Users,
  TrendingUp,
  Settings,
  Wallet,
  MoreHorizontal,
  LogOut,
  CheckCircle2,
  ShoppingCart,
  Receipt,
  BookOpen,
  ClipboardList,
  Landmark,
  BookUser,
} from 'lucide-react';
import { ToastContainer } from '@/components/ui/Toast';
import { TopNav } from '@/components/ui/TopNav';
import { Logo } from '@/components/ui/Logo';
import { Avatar } from '@/components/ui/Avatar';
import { getProfile, getProfileRole } from '@/lib/data/profiles';
import { countPendingMembershipRequests } from '@/lib/data/membership-requests';
import {
  countPendingReceipts,
  countRejectedReceiptsForUser,
} from '@/lib/data/receipts';
import {
  countAdminPendingLoans,
  countLoansActiveUnseenForUser,
  countLoansAwaitingMyVote,
  countLoansReadyForDisbursementForUser,
  countLoansRequiringActionForUser,
  countMyPendingLoanSharePurchases,
  type AdminPendingLoanCounts,
} from '@/lib/data/loans';
import type { TopNavNotificationItem } from '@/components/ui/TopNav';

type DashboardUser = {
  first: string;
  last: string;
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [role, setRole] = useState<'admin' | 'accionista' | null>(null);
  const [user, setUser] = useState<DashboardUser>({ first: '', last: '' });
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [pendingReceipts, setPendingReceipts] = useState<number>(0);
  const [pendingLoans, setPendingLoans] = useState<AdminPendingLoanCounts>({
    pendingReview: 0,
    pendingDisbursement: 0,
    total: 0,
  });
  // Conteos del accionista
  const [pendingVotes, setPendingVotes] = useState<number>(0);
  const [pendingRejected, setPendingRejected] = useState<number>(0);
  const [pendingLoanAction, setPendingLoanAction] = useState<number>(0);
  const [pendingLoanReady, setPendingLoanReady] = useState<number>(0);
  const [pendingLoanActive, setPendingLoanActive] = useState<number>(0);
  const [pendingLoanShares, setPendingLoanShares] = useState<number>(0);

  // Sidebar abrible/cerrable. En desktop arranca abierto; en mobile cerrado.
  // Usamos un state único: sidebarOpen. El layout aplica clases distintas
  // para overlay (mobile) o slot (desktop).
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  useEffect(() => {
    // En el primer render del cliente decidimos según viewport.
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  }, []);

  // En mobile, cerrar el sidebar al cambiar de página (UX clásica).
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setSidebarOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    const cleanupRef: { current: null | (() => void) } = { current: null };

    const fetchPendingCount = async () => {
      try {
        const count = await countPendingMembershipRequests(supabase);
        if (!cancelled) setPendingCount(count);
      } catch (err) {
        console.error('Error contando solicitudes pendientes:', err);
      }
    };

    const fetchPendingReceipts = async () => {
      try {
        const count = await countPendingReceipts(supabase);
        if (!cancelled) setPendingReceipts(count);
      } catch (err) {
        console.error('Error contando recibos pendientes:', err);
      }
    };

    const fetchPendingLoans = async () => {
      try {
        const counts = await countAdminPendingLoans(supabase);
        if (!cancelled) setPendingLoans(counts);
      } catch (err) {
        console.error('Error contando préstamos pendientes:', err);
      }
    };

    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user || cancelled) return;

      const [currentRole, profile] = await Promise.all([
        getProfileRole(supabase, data.user.id),
        getProfile(supabase, data.user.id).catch(() => null),
      ]);
      if (cancelled) return;

      setRole(currentRole);
      setUser({
        first: profile?.first_name ?? '',
        last: profile?.last_name ?? '',
      });

      if (currentRole === 'admin') {
        // Suscripciones a contadores pendientes — un único canal con varios
        // listeners para no abrir 3 websockets distintos.
        fetchPendingCount();
        fetchPendingReceipts();
        fetchPendingLoans();
        const channel = supabase
          .channel('dashboard-pending-counts')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'membership_requests' },
            () => fetchPendingCount(),
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'receipts' },
            () => fetchPendingReceipts(),
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'loans' },
            () => fetchPendingLoans(),
          )
          .subscribe();
        cleanupRef.current = () => supabase.removeChannel(channel);
      } else {
        // Accionista: contadores de cosas que requieren su acción —
        // préstamos esperando su voto y recibos rechazados (deben editar
        // y reenviar). Suscribimos a loans, loan_votes y receipts.
        const uid = data.user.id;
        const fetchPendingVotes = async () => {
          try {
            const n = await countLoansAwaitingMyVote(supabase, uid);
            if (!cancelled) setPendingVotes(n);
          } catch (err) {
            console.error('Error contando votos pendientes:', err);
          }
        };
        const fetchPendingRejected = async () => {
          try {
            const n = await countRejectedReceiptsForUser(supabase, uid);
            if (!cancelled) setPendingRejected(n);
          } catch (err) {
            console.error('Error contando recibos rechazados:', err);
          }
        };
        const fetchPendingLoanAction = async () => {
          try {
            const n = await countLoansRequiringActionForUser(supabase, uid);
            if (!cancelled) setPendingLoanAction(n);
          } catch (err) {
            console.error('Error contando préstamos por revisar:', err);
          }
        };
        const fetchPendingLoanReady = async () => {
          try {
            const n = await countLoansReadyForDisbursementForUser(supabase, uid);
            if (!cancelled) setPendingLoanReady(n);
          } catch (err) {
            console.error('Error contando préstamos listos para desembolso:', err);
          }
        };
        const fetchPendingLoanActive = async () => {
          try {
            const n = await countLoansActiveUnseenForUser(supabase, uid);
            if (!cancelled) setPendingLoanActive(n);
          } catch (err) {
            console.error('Error contando préstamos recién desembolsados:', err);
          }
        };
        const fetchPendingLoanShares = async () => {
          try {
            const n = await countMyPendingLoanSharePurchases(supabase);
            if (!cancelled) setPendingLoanShares(n);
          } catch (err) {
            console.error('Error contando acciones por préstamo pendientes:', err);
          }
        };
        fetchPendingVotes();
        fetchPendingRejected();
        fetchPendingLoanAction();
        fetchPendingLoanReady();
        fetchPendingLoanActive();
        fetchPendingLoanShares();
        const channel = supabase
          .channel(`dashboard-shareholder-counts-${uid}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'loans' },
            () => {
              fetchPendingVotes();
              fetchPendingLoanAction();
              fetchPendingLoanReady();
              fetchPendingLoanActive();
              fetchPendingLoanShares();
            },
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'loan_votes' },
            () => fetchPendingVotes(),
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'receipts', filter: `user_id=eq.${uid}` },
            () => {
              fetchPendingRejected();
              // Si el accionista envía/aprueban un recibo de
              // acciones_prestamo, este conteo cambia.
              fetchPendingLoanShares();
            },
          )
          .subscribe();
        cleanupRef.current = () => supabase.removeChannel(channel);
      }
    })();

    return () => {
      cancelled = true;
      cleanupRef.current?.();
    };
  }, []);

  type NavItem = {
    key: string;
    label: string;
    href: string;
    icon: typeof Home;
    badge?: number;
  };

  const adminNav: NavItem[] = [
    { key: 'home', label: 'Inicio', href: '/dashboard/admin', icon: Home },
    {
      key: 'solicitudes',
      label: 'Solicitudes',
      href: '/dashboard/solicitudes',
      icon: FileText,
      badge: pendingCount > 0 ? pendingCount : undefined,
    },
    { key: 'miembros', label: 'Accionistas', href: '/dashboard/miembros', icon: Users },
    {
      key: 'prestamos',
      label: 'Préstamos',
      href: '/dashboard/admin/prestamos',
      icon: Landmark,
      badge: pendingLoans.total > 0 ? pendingLoans.total : undefined,
    },
    {
      key: 'libro',
      label: 'Libro de caja',
      href: '/dashboard/libro-caja',
      icon: BookOpen,
      badge: pendingReceipts > 0 ? pendingReceipts : undefined,
    },
    {
      key: 'libro-accionista',
      label: 'Libro de accionista',
      href: '/dashboard/admin/libro-accionista',
      icon: BookUser,
    },
    {
      key: 'extractos',
      label: 'Extractos',
      href: '/dashboard/admin/extractos',
      icon: ClipboardList,
    },
    { key: 'ajustes', label: 'Ajustes', href: '/dashboard/ajustes', icon: Settings },
  ];

  const accionistaNav: NavItem[] = [
    { key: 'home', label: 'Mi capital', href: '/dashboard/accionista', icon: Wallet },
    {
      key: 'compras',
      label: 'Comprar',
      href: '/dashboard/compras',
      icon: ShoppingCart,
      badge: pendingLoanShares > 0 ? pendingLoanShares : undefined,
    },
    {
      key: 'prestamos',
      label: 'Préstamos',
      href: '/dashboard/prestamos',
      icon: Landmark,
      badge:
        pendingVotes + pendingLoanAction + pendingLoanReady + pendingLoanActive > 0
          ? pendingVotes + pendingLoanAction + pendingLoanReady + pendingLoanActive
          : undefined,
    },
    {
      key: 'historial',
      label: 'Historial',
      href: '/dashboard/historial',
      icon: Receipt,
      badge: pendingRejected > 0 ? pendingRejected : undefined,
    },
    { key: 'extracto', label: 'Extracto', href: '/dashboard/extracto', icon: ClipboardList },
    { key: 'ajustes', label: 'Ajustes', href: '/dashboard/ajustes', icon: Settings },
  ];

  // Default seguro: cuando aún no sabemos el role (null durante carga) o el
  // profile no existe (posible inconsistencia de DB), tratamos al usuario
  // como accionista. El acceso admin se protege en el servidor con
  // requireAdmin(), así que este default nunca concede permisos reales.
  const isAdmin = role === 'admin';
  const nav = isAdmin ? adminNav : accionistaNav;
  const roleLabel = isAdmin ? 'Administrador' : 'Accionista';
  const brandSubtitle = isAdmin ? 'Consola admin' : 'Mi cuenta';

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  // Items del dropdown de notificaciones del header. Cambian según el role.
  // El total y el filtrado por count > 0 lo hace TopNav.
  const buildNotifications = (): TopNavNotificationItem[] => {
    if (isAdmin) {
      return [
        {
          key: 'membership',
          label: 'Solicitudes de ingreso',
          count: pendingCount,
          href: '/dashboard/solicitudes',
          icon: FileText,
        },
        {
          key: 'receipts',
          label: 'Recibos por aprobar',
          count: pendingReceipts,
          href: '/dashboard/libro-caja',
          icon: Receipt,
        },
        {
          key: 'loan-review',
          label: 'Préstamos en revisión',
          count: pendingLoans.pendingReview,
          href: '/dashboard/admin/prestamos',
          icon: Landmark,
        },
        {
          key: 'loan-disb',
          label: 'Préstamos por desembolsar',
          count: pendingLoans.pendingDisbursement,
          href: '/dashboard/admin/prestamos',
          icon: Landmark,
        },
      ];
    }
    return [
      {
        key: 'votes',
        label: 'Préstamos esperando tu voto',
        count: pendingVotes,
        href: '/dashboard/prestamos/votar',
        icon: Landmark,
      },
      {
        key: 'loan-action',
        label: 'Préstamos por revisar o rechazados',
        count: pendingLoanAction,
        href: '/dashboard/prestamos',
        icon: Landmark,
      },
      {
        key: 'loan-ready',
        label: 'Préstamos listos para desembolso',
        count: pendingLoanReady,
        href: '/dashboard/prestamos',
        icon: Landmark,
      },
      {
        key: 'loan-active',
        label: 'Préstamos recién desembolsados',
        count: pendingLoanActive,
        href: '/dashboard/prestamos',
        icon: Landmark,
      },
      {
        key: 'rejected',
        label: 'Recibos por reenviar',
        count: pendingRejected,
        href: '/dashboard/historial',
        icon: Receipt,
      },
      {
        key: 'loan-shares',
        label: 'Acciones por préstamo por pagar',
        count: pendingLoanShares,
        href: '/dashboard/compras',
        icon: ShoppingCart,
      },
    ];
  };

  return (
    <div className="min-h-screen h-screen bg-[var(--color-bg)] text-[var(--color-text)] flex">
      <ToastContainer />

      {/* Backdrop mobile — solo cuando el sidebar está abierto y estamos
          bajo md. En desktop el backdrop nunca aparece. */}
      {sidebarOpen && (
        <div
          aria-hidden
          onClick={() => setSidebarOpen(false)}
          className="md:hidden fixed inset-0 z-30 bg-black/40 animate-in fade-in duration-150"
        />
      )}

      {/* Sidebar — fixed en mobile (overlay), inline en desktop. Cuando
          sidebarOpen es false se desliza fuera de pantalla. */}
      <aside
        className={`
          fixed md:static z-40 h-screen w-[248px] shrink-0
          bg-[var(--color-bg)] dark:bg-[var(--color-surface-sunken)]
          border-r border-[var(--color-border)]
          flex flex-col px-3.5 py-5
          transition-transform duration-200 ease-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:hidden'}
        `}
      >
        {/* Brand */}
        <div className="flex items-center gap-2.5 px-2.5 pt-1 pb-5">
          <div className="w-[34px] h-[34px] rounded-[9px] bg-[var(--color-brand)] flex items-center justify-center text-white dark:text-[var(--color-brand-ink)]">
            <Logo size={20} color="currentColor" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight leading-none">
              Ahorro Familiar
            </div>
            <div className="text-[11px] text-[var(--color-text-subtle)] tracking-tight mt-1">
              {brandSubtitle}
            </div>
          </div>
        </div>

        {/* Nav section */}
        <nav className="flex flex-col gap-0.5 mt-1.5">
          <div className="text-[10px] font-semibold text-[var(--color-text-subtle)] tracking-[0.12em] uppercase px-3 pt-3 pb-2">
            Principal
          </div>
          {nav.map((item) => {
            const active =
              item.href === pathname ||
              (item.key !== 'home' && pathname.startsWith(item.href));
            return (
              <NavItem
                key={item.key}
                href={item.href}
                label={item.label}
                icon={item.icon}
                badge={item.badge}
                active={active}
              />
            );
          })}
        </nav>

        {/* Admin: fund snapshot pill (solo cuando tengamos datos reales; por ahora placeholder) */}
        {role === 'admin' && (
          <div className="mt-auto mx-1.5 mb-3 p-3.5 rounded-[12px] bg-[var(--color-surface-alt)] dark:bg-[var(--color-surface)] border border-[var(--color-border)]">
            <div className="flex items-center gap-2 mb-2.5">
              <span
                className="w-2 h-2 rounded-full bg-[var(--color-success)]"
                aria-hidden
              />
              <span className="text-[11px] font-semibold text-[var(--color-text-muted)] tracking-wider uppercase">
                Fondo activo
              </span>
            </div>
            <div className="text-[20px] font-semibold tracking-[-0.02em] tabular">
              $ 48.720.500
            </div>
            <div className="text-xs text-[var(--color-text-muted)] mt-1 flex items-center gap-1">
              <CheckCircle2
                size={12}
                strokeWidth={1.75}
                className="text-[var(--color-success)]"
              />
              +2.4% este mes
            </div>
          </div>
        )}

        {/* User card (bottom) */}
        <div
          className={`${
            role === 'admin' ? '' : 'mt-auto'
          } flex items-center gap-2.5 px-2 py-2.5 border-t border-[var(--color-border)]`}
        >
          <Avatar name={user.first || '?'} size={32} />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold tracking-tight truncate">
              {user.first || user.last ? `${user.first} ${user.last}`.trim() : 'Usuario'}
            </div>
            <div className="text-[11px] text-[var(--color-text-subtle)]">
              {role ? roleLabel : 'Cargando...'}
            </div>
          </div>
          <button
            onClick={handleLogout}
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
            className="w-7 h-7 rounded-[7px] flex items-center justify-center text-[var(--color-text-subtle)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)] transition-colors"
          >
            <LogOut size={15} strokeWidth={1.75} />
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        <TopNav
          notifications={role ? buildNotifications() : undefined}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          sidebarOpen={sidebarOpen}
        />
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-[1440px] mx-auto px-4 md:px-5 lg:px-6 py-5 md:py-6 lg:py-7">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}

function NavItem({
  href,
  label,
  icon: IconComp,
  badge,
  active,
}: {
  href: string;
  label: string;
  icon: typeof Home;
  badge?: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 h-9 px-3 rounded-[8px] text-[13px] tracking-tight transition-colors ${
        active
          ? 'bg-[var(--color-surface)] text-[var(--color-text)] font-semibold border border-[var(--color-border)] shadow-sm-soft'
          : 'text-[var(--color-text-muted)] font-medium border border-transparent hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text)]'
      }`}
    >
      <IconComp
        size={17}
        strokeWidth={1.75}
        className={active ? 'text-[var(--color-brand)]' : 'text-[var(--color-text-subtle)]'}
      />
      <span className="flex-1">{label}</span>
      {badge ? (
        <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[var(--color-brand)] text-white dark:text-[var(--color-brand-ink)] text-[11px] font-bold inline-flex items-center justify-center">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

// Helper export para que otros módulos puedan importarlo si quieren
export { MoreHorizontal, TrendingUp };
