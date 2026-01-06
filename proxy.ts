
import { NextRequest, NextResponse } from 'next/server';
import { decrypt } from '@/lib/session';

// 1. Specify protected and public routes
const protectedRoutes = ['/admin', '/clients', '/billing', '/vendors', '/'];
const vendorRoutes = ['/vendor'];
const publicRoutes = ['/login', '/api/auth/login', '/api/process-weekly-orders', '/api/extension', '/verify-order', '/delivery'];

export default async function proxy(req: NextRequest) {
    // 2. Check if the current route is protected or public
    const path = req.nextUrl.pathname;

    // Exclude static assets/api if needed.
    if (path.startsWith('/_next') || path.startsWith('/static') || path.includes('.')) {
        return NextResponse.next();
    }

    const isPublicRoute = publicRoutes.includes(path) || path.startsWith('/verify-order/') || path.startsWith('/client-portal') || path.startsWith('/delivery/') || path.startsWith('/api/extension');
    const isVendorRoute = vendorRoutes.some(route => path.startsWith(route));
    // Check protected routes - handle root path separately to avoid matching all paths
    const isProtectedRoute = protectedRoutes.some(route =>
        route === '/' ? path === '/' : path.startsWith(route)
    );

    // 3. Decrypt the session from the cookie
    // In middleware, we must use req.cookies instead of cookies() from next/headers
    const cookie = req.cookies.get('session')?.value;
    const session = await decrypt(cookie || '');

    // 4. Redirect to appropriate login if the user is not authenticated
    if (!isPublicRoute && !session?.userId) {
        // Prevent redirect loop - don't redirect if already on login page
        if (path === '/login') {
            return NextResponse.next();
        }
        // Redirect vendor-login to regular login
        if (path === '/vendor-login') {
            return NextResponse.redirect(new URL('/login', req.url));
        }
        if (isVendorRoute) {
            return NextResponse.redirect(new URL('/login', req.url));
        }
        return NextResponse.redirect(new URL('/login', req.url));
    }

    // 5. Redirect if user tries to access wrong portal
    if (session?.userId) {
        // Vendor trying to access admin routes
        if (session.role === 'vendor' && isProtectedRoute) {
            // Don't redirect if already on a vendor route (shouldn't happen, but safety check)
            if (isVendorRoute) {
                return NextResponse.next();
            }
            return NextResponse.redirect(new URL('/vendor', req.url));
        }
        // Navigator trying to access admin/vendor routes
        if (session.role === 'navigator') {
            // Navigators can access /clients, /client-portal, /navigator-history, and /orders
            if (path.startsWith('/clients') || path.startsWith('/client-portal') || path.startsWith('/navigator-history') || path.startsWith('/orders')) {
                return NextResponse.next();
            }
            // Redirect to clients dashboard
            return NextResponse.redirect(new URL('/clients', req.url));
        }

        // Admin trying to access vendor routes
        if ((session.role === 'admin' || session.role === 'super-admin') && isVendorRoute) {
            // Don't redirect if already on a protected route (shouldn't happen, but safety check)
            if (isProtectedRoute) {
                return NextResponse.next();
            }
            return NextResponse.redirect(new URL('/clients', req.url));
        }
        // Redirect authenticated users away from login pages
        if (path === '/login' && (session.role === 'admin' || session.role === 'super-admin' || session.role === 'navigator')) {
            if (session.role === 'navigator') {
                return NextResponse.redirect(new URL('/clients', req.url));
            }
            return NextResponse.redirect(new URL('/clients', req.url));
        }
        // Redirect vendor-login to regular login, then handle authenticated vendors
        if (path === '/vendor-login') {
            if (session.role === 'vendor') {
                return NextResponse.redirect(new URL('/vendor', req.url));
            }
            return NextResponse.redirect(new URL('/login', req.url));
        }
    }

    return NextResponse.next();
}

// Routes Middleware should not run on
export const config = {
    matcher: ['/((?!_next/static|_next/image|.*\\.png$).*)'],
};
