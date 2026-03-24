/**
 * Central place for Supabase API keys (new `sb_*` keys + legacy JWT fallbacks).
 * Never commit real keys; set in .env.local only.
 *
 * If legacy JWTs are disabled in the Supabase dashboard but still present in .env,
 * they must come *after* new keys so we do not send rejected keys first.
 */

/** Best key for general PostgREST reads/writes via supabase-js (app singleton). */
export function getSupabaseDbApiKey(): string | undefined {
    const secret = process.env.SUPABASE_SECRET_KEY?.trim();
    const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY?.trim();
    const legacyService = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    const legacyAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
    return secret || publishable || legacyService || legacyAnon || undefined;
}

export type SupabaseDbKeySource = 'secret' | 'publishable' | 'legacy_service' | 'legacy_anon';

/** Which env var supplied the DB API key (for logs only; no secrets). */
export function getSupabaseDbKeySource(): SupabaseDbKeySource | null {
    if (process.env.SUPABASE_SECRET_KEY?.trim()) return 'secret';
    if (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY?.trim()) return 'publishable';
    if (process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return 'legacy_service';
    if (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()) return 'legacy_anon';
    return null;
}

/**
 * Elevated server key only: new secret or legacy service_role JWT (not publishable).
 * Use when an operation must bypass RLS like the old service role; requires one of these set.
 */
export function getSupabaseServerSecretKey(): string | undefined {
    const k =
        process.env.SUPABASE_SECRET_KEY?.trim() ||
        process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    return k || undefined;
}

/** Extension-style fallbacks: full chain including publishable + legacy anon. */
export function getSupabaseServiceOrAnonKey(): string | undefined {
    return getSupabaseDbApiKey();
}
