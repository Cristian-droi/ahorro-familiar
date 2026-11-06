import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@/types/database';
import { getProfileAdminRole } from '@/lib/data/profiles';
import { esRutaAdmin, puedeLeerAdmin, rutaDeInicio } from '@/shared/domain/acceso-admin';

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
    // Authoritative role from `profiles`, protected by RLS. user_metadata is not
    // authoritative because the user can edit it. Every user is a shareholder, so
    // nobody is redirected out of "Mi cuenta".
    const adminRole = await getProfileAdminRole(supabase, user.id);

    if (!puedeLeerAdmin(adminRole) && esRutaAdmin(pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = '/dashboard/accionista';
      return NextResponse.redirect(url);
    }

    if (isPublicEntry) {
      const url = request.nextUrl.clone();
      url.pathname = rutaDeInicio(adminRole);
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
