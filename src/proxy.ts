import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@/types/database';
import { getProfileRole } from '@/lib/data/profiles';

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value: '', ...options });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isDashboardPage = pathname.startsWith('/dashboard');
  const isPublicEntry = pathname === '/' || pathname === '/login';

  if (!user && isDashboardPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (user) {
    // Rol autoritativo desde `profiles` (protegido por RLS).
    // user_metadata.role NO es autoritativo: el usuario puede editarlo.
    const role = (await getProfileRole(supabase, user.id)) ?? 'accionista';
    const isAdmin = role === 'admin';

    const isAccionistaArea = pathname.startsWith('/dashboard/accionista');
    const isAdminArea =
      pathname.startsWith('/dashboard/admin') ||
      pathname.startsWith('/dashboard/solicitudes') ||
      pathname.startsWith('/dashboard/miembros');

    if (!isAdmin && isAdminArea) {
      const url = request.nextUrl.clone();
      url.pathname = '/dashboard/accionista';
      return NextResponse.redirect(url);
    }

    if (isAdmin && isAccionistaArea) {
      const url = request.nextUrl.clone();
      url.pathname = '/dashboard/admin';
      return NextResponse.redirect(url);
    }

    if (isPublicEntry) {
      const url = request.nextUrl.clone();
      url.pathname = isAdmin ? '/dashboard/admin' : '/dashboard/accionista';
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
