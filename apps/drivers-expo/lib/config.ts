/**
 * Base URL for the Next.js app (no trailing slash).
 * Defaults to `http://localhost:3000` (run `npm run sync-env` or copy `.env.example` to `.env`).
 * Simulator/emulator on the same Mac/PC can use localhost; a physical device needs your host LAN IP.
 */
export function getApiBaseUrl(): string {
    const u = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
    if (!u) return 'http://localhost:3000';
    return u.replace(/\/$/, '');
}
