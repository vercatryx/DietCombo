import { NextRequest, NextResponse } from 'next/server';
import { decrypt } from '@/lib/session';
import { mergeSupabaseCookies, updateSession } from '@/utils/supabase/middleware';

// Protected (admin) routes — require auth; unauthenticated users redirect to /login
const protectedRoutes = ['/admin', '/clients', '/billing', '/vendors', '/orders', '/routes', '/forms', '/'];
// Vendor portal only (singular): /vendor and /vendor/... — NOT /vendors (admin list)
const isVendorPortalRoute = (path: string) => path === '/vendor' || path.startsWith('/vendor/');

const publicRoutes = ['/login', '/login/verify', '/api/auth/login', '/api/extension', '/verify-order', '/delivery', '/drivers', '/produce', '/sign'];

export default async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  if (path.startsWith('/_next') || path.startsWith('/static') || path.includes('.')) {
    return NextResponse.next();
  }

  const supabaseRes = await updateSession(request);
  const redirectWithSb = (url: URL) => mergeSupabaseCookies(supabaseRes, NextResponse.redirect(url));

  // /vendors/produce is public only when accessed with a token (vendor link); otherwise it requires login
  const vendorsProduceWithToken =
    (path === '/vendors/produce' || path.startsWith('/vendors/produce/')) &&
    !!request.nextUrl.searchParams.get('token');

  const isPublicRoute =
    publicRoutes.includes(path) ||
    path.startsWith('/verify-order/') ||
    path.startsWith('/delivery/') ||
    path.startsWith('/drivers/') ||
    path.startsWith('/produce/') ||
    vendorsProduceWithToken ||
    path.startsWith('/api/') ||
    path.startsWith('/sign/');
  const isVendorRoute = isVendorPortalRoute(path);
  const isProtectedRoute = protectedRoutes.some((route) =>
    route === '/' ? path === '/' : path.startsWith(route)
  );

  const cookie = request.cookies.get('session')?.value;
  const session = await decrypt(cookie || '');

  // Redirect to login if accessing protected/vendor route without session
  if (!isPublicRoute && !session?.userId) {
    if (path === '/vendor-login') {
      return redirectWithSb(new URL('/login', request.url));
    }
    return redirectWithSb(new URL('/login', request.url));
  }

  // API routes enforce their own auth (cookies, Bearer tokens, etc.). Do not apply
  // session role redirects — they would 307 brooklyn_admin/client away from e.g. /api/extension/* when the browser sends a session cookie.
  if (path.startsWith('/api/')) {
    return supabaseRes;
  }

  // Role-based redirects when user is logged in
  if (session?.userId) {
    // Brooklyn admin: only Client Dashboard (Brooklyn), Routes (Brooklyn), Meal Plan Edits (Brooklyn). No Orders, Billing, Admin.
    if (session.role === 'brooklyn_admin') {
      const allowed =
        path === '/' ||
        path.startsWith('/clients') ||
        path.startsWith('/routes') ||
        path.startsWith('/meal-plan-edits');
      if (!allowed) {
        return redirectWithSb(new URL('/clients', request.url));
      }
      if (path === '/login') {
        return redirectWithSb(new URL('/clients', request.url));
      }
      return supabaseRes;
    }

    // Clients: only their own portal (and /sign/). No other clients, no admin routes.
    if (session.role === 'client') {
      const ownPortalBase = `/client-portal/${session.userId}`;
      const isOwnPortal = path === ownPortalBase || path.startsWith(ownPortalBase + '/');
      const isSignRoute = path.startsWith('/sign/');
      if (!isOwnPortal && !isSignRoute) {
        return redirectWithSb(new URL(ownPortalBase, request.url));
      }
      return supabaseRes;
    }

    // Admin / super-admin: full access to all app routes (only vendor portal redirects to /clients)
    if (session.role === 'admin' || session.role === 'super-admin') {
      if (isVendorRoute) {
        return redirectWithSb(new URL('/clients', request.url));
      }
      return supabaseRes;
    }

    if (session.role === 'vendor' && isProtectedRoute && !isVendorRoute) {
      return redirectWithSb(new URL('/vendor', request.url));
    }

    if (session.role === 'navigator') {
      if (
        path.startsWith('/clients') ||
        path.startsWith('/client-portal') ||
        path.startsWith('/navigator-history') ||
        path.startsWith('/orders') ||
        path.startsWith('/vendors')
      ) {
        return supabaseRes;
      }
      if (isProtectedRoute || path === '/') {
        return redirectWithSb(new URL('/clients', request.url));
      }
    }

    if (path === '/login' && session.role === 'client') {
      return redirectWithSb(new URL(`/client-portal/${session.userId}`, request.url));
    }
    if (path === '/login' && (session.role === 'admin' || session.role === 'super-admin' || session.role === 'navigator' || session.role === 'brooklyn_admin')) {
      return redirectWithSb(new URL(session.role === 'brooklyn_admin' ? '/clients' : '/clients', request.url));
    }
    if (path === '/login' && session.role === 'vendor') {
      return redirectWithSb(new URL('/vendor', request.url));
    }
    if (path === '/vendor-login') {
      return session.role === 'vendor'
        ? redirectWithSb(new URL('/vendor', request.url))
        : redirectWithSb(new URL('/login', request.url));
    }
  }

  return supabaseRes;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|.*\\.png$).*)'],
};
