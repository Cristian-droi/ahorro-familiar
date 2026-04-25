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
        // Suscripción a solicitudes pendientes solo tiene sentido para admin.
        fetchPendingCount();
        const channel = supabase
          .channel('dashboard-pending-count')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'membership_requests' },
            () => fetchPendingCount(),
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
    { key: 'prestamos', label: 'Préstamos', href: '/dashboard/admin/prestamos', icon: Landmark },
    { key: 'libro', label: 'Libro de caja', href: '/dashboard/libro-caja', icon: BookOpen },
    {
      key: 'libro-accionista',
      label: 'Libro de accionista',
      href: '/dashboard/admin/libro-accionista',
      icon: BookUser,
    },
    { key: 'ajustes', label: 'Ajustes', href: '/dashboard/ajustes', icon: Settings },
  ];

  const accionistaNav: NavItem[] = [
    { key: 'home', label: 'Mi capital', href: '/dashboard/accionista', icon: Wallet },
    { key: 'compras', label: 'Comprar', href: '/dashboard/compras', icon: ShoppingCart },
    { key: 'prestamos', label: 'Préstamos', href: '/dashboard/prestamos', icon: Landmark },
    { key: 'historial', label: 'Historial', href: '/dashboard/historial', icon: Receipt },
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

  return (
    <div className="min-h-screen h-screen bg-[var(--color-bg)] text-[var(--color-text)] flex">
      <ToastContainer />

      {/* Sidebar */}
      <aside className="w-[248px] shrink-0 h-screen bg-[var(--color-bg)] dark:bg-[var(--color-surface-sunken)] border-r border-[var(--color-border)] flex flex-col px-3.5 py-5">
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
        <TopNav />
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-[1200px] mx-auto px-6 lg:px-9 py-7 lg:py-8">{children}</div>
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
