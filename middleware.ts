import { NextRequest, NextResponse } from 'next/server';
import { decrypt } from '@/lib/session';

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
      return NextResponse.redirect(new URL('/login', request.url));
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Role-based redirects when user is logged in
  if (session?.userId) {
    // Clients: only their own portal (and /sign/). No other clients, no admin routes.
    if (session.role === 'client') {
      const ownPortalBase = `/client-portal/${session.userId}`;
      const isOwnPortal = path === ownPortalBase || path.startsWith(ownPortalBase + '/');
      const isSignRoute = path.startsWith('/sign/');
      if (!isOwnPortal && !isSignRoute) {
        return NextResponse.redirect(new URL(ownPortalBase, request.url));
      }
      return NextResponse.next();
    }

    // Admin / super-admin: full access to all app routes (only vendor portal redirects to /clients)
    if (session.role === 'admin' || session.role === 'super-admin') {
      if (isVendorRoute) {
        return NextResponse.redirect(new URL('/clients', request.url));
      }
      return NextResponse.next();
    }

    if (session.role === 'vendor' && isProtectedRoute && !isVendorRoute) {
      return NextResponse.redirect(new URL('/vendor', request.url));
    }

    if (session.role === 'navigator') {
      if (
        path.startsWith('/clients') ||
        path.startsWith('/client-portal') ||
        path.startsWith('/navigator-history') ||
        path.startsWith('/orders') ||
        path.startsWith('/vendors')
      ) {
        return NextResponse.next();
      }
      if (isProtectedRoute || path === '/') {
        return NextResponse.redirect(new URL('/clients', request.url));
      }
    }

    if (path === '/login' && session.role === 'client') {
      return NextResponse.redirect(new URL(`/client-portal/${session.userId}`, request.url));
    }
    if (path === '/login' && (session.role === 'admin' || session.role === 'super-admin' || session.role === 'navigator')) {
      return NextResponse.redirect(new URL('/clients', request.url));
    }
    if (path === '/login' && session.role === 'vendor') {
      return NextResponse.redirect(new URL('/vendor', request.url));
    }
    if (path === '/vendor-login') {
      return session.role === 'vendor'
        ? NextResponse.redirect(new URL('/vendor', request.url))
        : NextResponse.redirect(new URL('/login', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|.*\\.png$).*)'],
};
