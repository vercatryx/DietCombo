import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

/**
 * Refreshes the Supabase Auth session and returns a NextResponse that may set auth cookies.
 * Call from root middleware and copy cookies onto any redirect responses you return.
 */
export async function updateSession(request: NextRequest) {
    if (!supabaseUrl || !supabaseKey) {
        return NextResponse.next({
            request: { headers: request.headers },
        });
    }

    let supabaseResponse = NextResponse.next({
        request: { headers: request.headers },
    });

    const supabase = createServerClient(supabaseUrl, supabaseKey, {
        cookies: {
            getAll() {
                return request.cookies.getAll();
            },
            setAll(cookiesToSet) {
                cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
                supabaseResponse = NextResponse.next({
                    request: { headers: request.headers },
                });
                cookiesToSet.forEach(({ name, value, options }) =>
                    supabaseResponse.cookies.set(name, value, options)
                );
            },
        },
    });

    await supabase.auth.getUser();

    return supabaseResponse;
}

/** Apply cookies from the Supabase refresh response onto another response (e.g. redirects). */
export function mergeSupabaseCookies(from: NextResponse, onto: NextResponse) {
    from.cookies.getAll().forEach((c) => {
        onto.cookies.set(c.name, c.value, {
            path: c.path,
            domain: c.domain,
            maxAge: c.maxAge,
            expires: c.expires,
            httpOnly: c.httpOnly,
            secure: c.secure,
            sameSite: c.sameSite as 'lax' | 'strict' | 'none' | undefined,
        });
    });
    return onto;
}
