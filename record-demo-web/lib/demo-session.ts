import { cookies } from 'next/headers';

/** Demo console session (no external auth). */
export async function getSession() {
  return { userId: 'demo-admin', name: 'Demo Admin', role: 'admin' as const };
}

export async function encrypt(payload: unknown) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export async function decrypt(input: string): Promise<unknown | null> {
  try {
    const json = Buffer.from(input, 'base64url').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export async function createSession(_userId?: string, _name?: string, _role?: string) {
  const cookieStore = await cookies();
  cookieStore.set('session', 'demo', { path: '/', sameSite: 'lax' });
}

export async function deleteSession() {
  const cookieStore = await cookies();
  cookieStore.delete('session');
}

export async function verifySession() {
  return { isAuth: true as const, userId: 'demo-admin', name: 'Demo Admin', role: 'admin' as const };
}
