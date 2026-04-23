import { createHmac, timingSafeEqual } from 'crypto';

export type AccountPickTokenPayload = {
    v: 1;
    email: string;
    exp: number;
    keys: string[];
};

function pickSecret(): string {
    const s =
        process.env.LOGIN_ACCOUNT_PICK_SECRET ||
        process.env.SUPABASE_SECRET_KEY ||
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        '';
    return s.length >= 16 ? s.slice(0, 64) : '';
}

/**
 * Signed token proving OTP succeeded. `emailNormalized` is the passwordless lookup key:
 * normalized email, or `sms:+E164` for phone login. `keys` are `${type}:${id}` allowlist.
 */
export function signAccountPickToken(emailNormalized: string, keys: string[], ttlSec = 600): string | null {
    const secret = pickSecret();
    if (!secret) return null;
    const exp = Math.floor(Date.now() / 1000) + ttlSec;
    const payload: AccountPickTokenPayload = {
        v: 1,
        email: emailNormalized,
        exp,
        keys: [...new Set(keys)].sort(),
    };
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = createHmac('sha256', secret).update(body).digest('base64url');
    return `${body}.${sig}`;
}

export function verifyAccountPickToken(token: string): AccountPickTokenPayload | null {
    const secret = pickSecret();
    if (!secret) return null;
    const lastDot = token.lastIndexOf('.');
    if (lastDot <= 0) return null;
    const body = token.slice(0, lastDot);
    const sig = token.slice(lastDot + 1);
    const expected = createHmac('sha256', secret).update(body).digest('base64url');
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    let payload: AccountPickTokenPayload;
    try {
        payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AccountPickTokenPayload;
    } catch {
        return null;
    }
    if (payload.v !== 1 || typeof payload.email !== 'string' || !Array.isArray(payload.keys)) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
}
